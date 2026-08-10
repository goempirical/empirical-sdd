import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EmpiricalProject } from "../src/core.js";
import { EmpiricalError } from "../src/errors.js";
import { digestJson } from "../src/protocol.js";
import { parseTrackerPolicy, trackerProgress } from "../src/tracking.js";
import type {
  JiraTrackerPolicy,
  GitHubTrackerPolicy,
  LinearTrackerPolicy,
  TrackerHttpRequest,
  TrackerHttpResponse,
  TrackerStateMap,
  TrackerTransport,
  WorkflowState,
} from "../src/types.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const states: TrackerStateMap = {
  specification: "state-spec",
  planned: "state-plan",
  "in-progress": "state-work",
  verification: "state-verify",
  review: "state-review",
  blocked: "state-blocked",
  done: "state-done",
};

function linearPolicy(): LinearTrackerPolicy {
  return {
    schemaVersion: 1,
    provider: "linear",
    target: { teamId: "team-1", projectId: "project-1" },
    credentialEnv: { apiKey: "LINEAR_API_KEY" },
    states,
  };
}

function githubPolicy(): GitHubTrackerPolicy {
  return {
    schemaVersion: 1,
    provider: "github",
    target: {
      owner: "goempirical",
      repository: "empirical-sdd",
      projectId: "PVT_project",
      statusFieldId: "PVTSSF_status",
    },
    credentialEnv: { token: "GITHUB_TOKEN" },
    states,
  };
}

function jiraPolicy(): JiraTrackerPolicy {
  return {
    schemaVersion: 1,
    provider: "jira",
    target: {
      siteUrl: "https://empirical.atlassian.net",
      projectKey: "ENG",
      issueTypeId: "10001",
    },
    credentialEnv: { email: "JIRA_EMAIL", apiToken: "JIRA_API_TOKEN" },
    states,
  };
}

async function projectWithFastFeature() {
  const root = await mkdtemp(join(tmpdir(), "empirical-tracker-"));
  directories.push(root);
  const { project } = await EmpiricalProject.initialize(root, {
    integrations: false,
    evidence: {
      required: false,
      browserForUi: false,
      screenshotForUi: false,
      codeReview: false,
    },
    setupComplete: true,
  });
  const action = await project.fast("Add a local tracker fixture");
  if (action.kind !== "action") throw new Error("Expected action");
  return { root, project, action };
}

function sequence(items: Array<TrackerHttpResponse | Error>) {
  const calls: TrackerHttpRequest[] = [];
  const transport: TrackerTransport = async (request) => {
    calls.push(request);
    const item = items.shift();
    if (!item) throw new Error(`Unexpected request: ${request.method} ${request.url}`);
    if (item instanceof Error) throw item;
    return item;
  };
  return { calls, transport, remaining: items };
}

function json(status: number, value: unknown): TrackerHttpResponse {
  return { status, body: JSON.stringify(value) };
}

describe("external ticket tracking", () => {
  test("missing policy is local-only and status never contacts a provider", async () => {
    const { project, action } = await projectWithFastFeature();
    let requests = 0;
    const status = await project.statusReport();
    expect(status.tracker).toEqual({
      health: "local-only",
      provider: null,
      url: null,
      committedRevision: action.revision,
      lastSyncedRevision: null,
      pendingRevision: null,
      failure: null,
    });
    await project.syncTracker({
      transport: async () => {
        requests += 1;
        return json(500, {});
      },
    });
    expect(requests).toBe(0);
  });

  test("policy is strict, complete, credential-free, and rejects unsafe Jira sites", () => {
    expect(parseTrackerPolicy(linearPolicy())).toEqual(linearPolicy());
    expect(() => parseTrackerPolicy({
      ...linearPolicy(),
      apiKey: "lin_api_should-never-be-persisted",
    })).toThrow("strict secret-free target");
    expect(() => parseTrackerPolicy({
      ...linearPolicy(),
      target: { ...linearPolicy().target, teamId: "lin_api_abcdefghijklmnopqrstuvwxyz" },
    })).toThrow("secret-like value");
    expect(() => parseTrackerPolicy({
      ...linearPolicy(),
      states: { ...states, done: undefined },
    })).toThrow("strict secret-free target");
    expect(() => parseTrackerPolicy({
      ...jiraPolicy(),
      target: { ...jiraPolicy().target, siteUrl: "https://person:token@empirical.atlassian.net/path" },
    })).toThrow("Atlassian Cloud HTTPS origin");
    expect(() => parseTrackerPolicy({
      ...jiraPolicy(),
      target: { ...jiraPolicy().target, siteUrl: "https://localhost" },
    })).toThrow("Atlassian Cloud HTTPS origin");
  });

  test("phase and stop conditions map to the normalized progress model", () => {
    const base = {
      status: "waiting",
      phase: "specify",
    } as WorkflowState;
    expect(trackerProgress(base)).toBe("specification");
    expect(trackerProgress({ ...base, phase: "plan" })).toBe("planned");
    expect(trackerProgress({ ...base, phase: "context" })).toBe("in-progress");
    expect(trackerProgress({ ...base, phase: "verify" })).toBe("verification");
    expect(trackerProgress({ ...base, phase: "integrate" })).toBe("review");
    expect(trackerProgress({ ...base, phase: "done", status: "done" })).toBe("done");
    expect(trackerProgress({ ...base, phase: "implement", status: "blocked" })).toBe("blocked");
    expect(trackerProgress({ ...base, phase: "review", status: "awaiting_human" })).toBe("blocked");
  });

  test("missing credentials fail before transport and persist only the environment name", async () => {
    const { root, project, action } = await projectWithFastFeature();
    await project.configureTracker(linearPolicy());
    let requests = 0;
    const result = await project.bindTracker(
      { mode: "attach", ticket: "EMP-2" },
      {
        env: {},
        transport: async () => {
          requests += 1;
          return json(200, {});
        },
      },
    );
    expect(requests).toBe(0);
    expect(result.tracker).toMatchObject({
      health: "failed",
      failure: { code: "TRACKER_CREDENTIAL_MISSING" },
    });
    const persisted = [
      await readFile(join(root, ".empirical", "tracker.json"), "utf8"),
      await readFile(join(root, ".empirical", "specs", action.feature!, "tracker", "pending.json"), "utf8"),
    ].join("\n");
    expect(persisted).toContain("LINEAR_API_KEY");
    expect(persisted).not.toContain("lin_api_");
  });

  test("rate limits and malformed provider responses remain retryable local failures", async () => {
    const { project } = await projectWithFastFeature();
    await project.configureTracker(linearPolicy());
    const fake = sequence([
      { status: 429, body: "private provider response that must not be retained" },
      json(200, { data: { issue: { id: "linear-uuid", identifier: "EMP-3" } } }),
    ]);
    const rateLimited = await project.bindTracker(
      { mode: "attach", ticket: "EMP-3" },
      { transport: fake.transport, env: { LINEAR_API_KEY: "linear-secret" } },
    );
    expect(rateLimited.tracker).toMatchObject({
      health: "failed",
      failure: { code: "TRACKER_HTTP_FAILED", summary: "Tracker returned HTTP 429" },
    });
    expect(rateLimited.tracker.failure?.summary).not.toContain("private provider response");

    const malformed = await project.bindTracker(
      { mode: "attach", ticket: "EMP-3" },
      { transport: fake.transport, env: { LINEAR_API_KEY: "linear-secret" } },
    );
    expect(malformed.tracker).toMatchObject({
      health: "failed",
      failure: { code: "TRACKER_MALFORMED_RESPONSE" },
    });
    expect(fake.remaining).toHaveLength(0);
  });

  test("Linear create binds, projects, survives a later local commit, and resynchronizes", async () => {
    const { root, project, action } = await projectWithFastFeature();
    await project.configureTracker(linearPolicy());
    const fake = sequence([
      json(200, { data: { issueCreate: { success: true, issue: { id: "linear-uuid", identifier: "EMP-1", url: "https://linear.app/empirical/issue/EMP-1" } } } }),
      json(200, { data: { issue: { id: "linear-uuid", identifier: "EMP-1", url: "https://linear.app/empirical/issue/EMP-1", description: "User description" } } }),
      json(200, { data: { issueUpdate: { success: true, issue: { id: "linear-uuid", identifier: "EMP-1", url: "https://linear.app/empirical/issue/EMP-1" } } } }),
      json(200, { data: { issue: { id: "linear-uuid", identifier: "EMP-1", url: "https://linear.app/empirical/issue/EMP-1", description: "User description" } } }),
      json(200, { data: { issueUpdate: { success: true, issue: { id: "linear-uuid", identifier: "EMP-1", url: "https://linear.app/empirical/issue/EMP-1" } } } }),
    ]);
    const bound = await project.bindTracker(
      { mode: "create", title: "External ticket tracking" },
      { transport: fake.transport, env: { LINEAR_API_KEY: "linear-secret" }, now: () => new Date("2026-08-09T12:00:00.000Z") },
    );
    expect(bound.tracker).toMatchObject({ health: "synced", provider: "linear", lastSyncedRevision: 1 });
    expect(fake.calls[0]).toMatchObject({ method: "POST", url: "https://api.linear.app/graphql" });
    expect(fake.calls[0]?.headers.Authorization).toBe("linear-secret");
    expect(fake.calls[2]?.body).toContain("empirical-sdd:add-a-local-tracker-fixture:r1");

    const persisted = await readFile(join(root, ".empirical", "tracker.json"), "utf8");
    expect(persisted).not.toContain("linear-secret");
    expect(await readFile(join(root, ".empirical", "specs", action.feature!, "tracker", "binding.json"), "utf8"))
      .not.toContain("linear-secret");

    const completed = await project.complete({
      revision: action.revision,
      outcome: "passed",
      summary: "Completed locally before the next tracker request",
    });
    expect(completed.phase).toBe("done");
    expect(completed.tracker).toMatchObject({ health: "pending", committedRevision: 2, lastSyncedRevision: 1 });
    expect((await project.statusReport()).tracker.health).toBe("pending");

    const synced = await project.syncTracker({
      transport: fake.transport,
      env: { LINEAR_API_KEY: "linear-secret" },
      now: () => new Date("2026-08-09T12:01:00.000Z"),
    });
    expect(synced.tracker).toMatchObject({ health: "synced", committedRevision: 2, lastSyncedRevision: 2 });
    expect(fake.remaining).toHaveLength(0);

    const pendingPath = join(root, ".empirical", "specs", action.feature!, "tracker", "pending.json");
    const persistedPending = JSON.parse(await readFile(pendingPath, "utf8")) as Record<string, unknown>;
    const { digest: _digest, ...pendingBody } = persistedPending;
    const interruptedBody = {
      ...pendingBody,
      status: "failed",
      failure: {
        code: "TRACKER_FAILED",
        summary: "Simulated crash after binding acknowledgement",
        at: "2026-08-09T12:02:00.000Z",
      },
      updatedAt: "2026-08-09T12:02:00.000Z",
    };
    await writeFile(pendingPath, `${JSON.stringify({
      ...interruptedBody,
      digest: digestJson(interruptedBody),
    }, null, 2)}\n`, "utf8");
    let repairRequests = 0;
    const repaired = await project.syncTracker({
      transport: async () => {
        repairRequests += 1;
        throw new Error("Crash-gap repair must not repeat an acknowledged request");
      },
      env: { LINEAR_API_KEY: "linear-secret" },
      now: () => new Date("2026-08-09T12:03:00.000Z"),
    });
    expect(repairRequests).toBe(0);
    expect(repaired.tracker.health).toBe("synced");
    expect(JSON.parse(await readFile(pendingPath, "utf8"))).toMatchObject({ status: "synced", failure: null });
  });

  test("GitHub create keeps exactly one machine-owned marker in the project comment", async () => {
    const { project } = await projectWithFastFeature();
    await project.configureTracker(githubPolicy());
    const fake = sequence([
      json(201, { node_id: "I_kwDO_created", number: 43, html_url: "https://github.com/goempirical/empirical-sdd/issues/43" }),
      json(200, { data: { node: { projectItems: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } }),
      json(200, { data: { addProjectV2ItemById: { item: { id: "PVTI_created" } } } }),
      json(200, []),
      json(201, { id: 988 }),
      json(200, { data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_created" } } } }),
    ]);
    const result = await project.bindTracker(
      { mode: "create", description: "User-owned issue description" },
      { transport: fake.transport, env: { GITHUB_TOKEN: "github-secret" } },
    );
    expect(result.tracker.health).toBe("synced");
    expect(fake.calls[0]?.body).not.toContain("empirical-sdd:add-a-local-tracker-fixture:start");
    expect(fake.calls[3]?.method).toBe("GET");
    expect(fake.calls[4]?.body).toContain("empirical-sdd:add-a-local-tracker-fixture:start");
  });

  test("GitHub attachment adopts an existing Projects v2 item, upserts one comment, and moves Status", async () => {
    const { project } = await projectWithFastFeature();
    await project.configureTracker(githubPolicy());
    const fake = sequence([
      json(200, { node_id: "I_kwDO_issue", number: 42, html_url: "https://github.com/goempirical/empirical-sdd/issues/42" }),
      json(200, { data: { node: { projectItems: { nodes: [{ id: "PVTI_item", project: { id: "PVT_project" } }], pageInfo: { hasNextPage: false, endCursor: null } } } } }),
      json(200, [{ id: 987, body: "<!-- empirical-sdd:add-a-local-tracker-fixture:start -->\nstale\n<!-- empirical-sdd:add-a-local-tracker-fixture:end -->" }]),
      json(200, { id: 987 }),
      json(200, { data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_item" } } } }),
    ]);
    const result = await project.bindTracker(
      { mode: "attach", ticket: "42" },
      { transport: fake.transport, env: { GITHUB_TOKEN: "github-secret" } },
    );
    expect(result.binding).toMatchObject({
      provider: "github",
      remoteKey: "42",
      projectItemId: "PVTI_item",
      markerId: "987",
      lastSyncedRevision: 1,
    });
    expect(fake.calls.map(({ method }) => method)).toEqual(["GET", "POST", "GET", "PATCH", "POST"]);
    expect(fake.calls[1]?.body).toContain("projectItems(first: 100");
    expect(fake.calls[2]?.url).toContain("/issues/42/comments?per_page=100&page=1");
    expect(fake.calls[3]?.url).toEndWith("/issues/comments/987");
    expect(fake.calls[4]?.body).toContain("updateProjectV2ItemFieldValue");
  });

  test("Jira attachment writes the issue property and selects a transition by destination status", async () => {
    const { project } = await projectWithFastFeature();
    const policy = jiraPolicy();
    await project.configureTracker(policy);
    const desired = policy.states["in-progress"];
    const fake = sequence([
      json(200, { id: "10010", key: "ENG-7", fields: { status: { id: "state-old" } } }),
      json(200, { id: "10010", key: "ENG-7", fields: { status: { id: "state-old" } } }),
      { status: 204, body: "" },
      json(200, { transitions: [{ id: "71", to: { id: desired } }] }),
      { status: 204, body: "" },
    ]);
    const result = await project.bindTracker(
      { mode: "attach", ticket: "ENG-7" },
      {
        transport: fake.transport,
        env: { JIRA_EMAIL: "dev@example.com", JIRA_API_TOKEN: "jira-secret" },
      },
    );
    expect(result.tracker.health).toBe("synced");
    expect(result.binding?.url).toBe("https://empirical.atlassian.net/browse/ENG-7");
    expect(fake.calls[2]?.url).toEndWith("/properties/empirical-sdd");
    expect(fake.calls[2]?.body).toContain('"revision":1');
    expect(fake.calls[4]?.body).toBe('{"transition":{"id":"71"}}');
    expect(fake.calls[0]?.headers.Authorization).toStartWith("Basic ");
  });

  test("provider failure is redacted and cannot roll back the committed workflow", async () => {
    const { project, action } = await projectWithFastFeature();
    await project.configureTracker(linearPolicy());
    const initial = sequence([
      json(200, { data: { issue: { id: "linear-uuid", identifier: "EMP-9", url: "https://linear.app/empirical/issue/EMP-9" } } }),
      json(200, { data: { issue: { id: "linear-uuid", identifier: "EMP-9", url: "https://linear.app/empirical/issue/EMP-9", description: "" } } }),
      json(200, { data: { issueUpdate: { success: true, issue: { id: "linear-uuid", identifier: "EMP-9", url: "https://linear.app/empirical/issue/EMP-9" } } } }),
    ]);
    expect((await project.bindTracker(
      { mode: "attach", ticket: "EMP-9" },
      { transport: initial.transport, env: { LINEAR_API_KEY: "super-secret-key" } },
    )).tracker.health).toBe("synced");

    const completed = await project.complete({
      revision: action.revision,
      outcome: "passed",
      summary: "Local workflow is terminal",
    });
    const failed = sequence([
      { status: 500, body: "Authorization: super-secret-key token=ghp_abcdefghijklmnopqrstuvwxyz123456" },
    ]);
    const sync = await project.syncTracker({
      transport: failed.transport,
      env: { LINEAR_API_KEY: "super-secret-key" },
      now: () => new Date("2026-08-09T13:00:00.000Z"),
    });
    expect(sync.tracker).toMatchObject({ health: "failed", committedRevision: completed.revision, lastSyncedRevision: 1 });
    expect(sync.tracker.failure?.summary).not.toContain("super-secret-key");
    expect(sync.tracker.failure?.summary).not.toContain("ghp_");
    expect(await project.status()).toMatchObject({ phase: "done", status: "done", revision: completed.revision });
  });

  test("an ambiguous create is not repeated without explicit confirmation", async () => {
    const { project } = await projectWithFastFeature();
    await project.configureTracker(linearPolicy());
    const failed = sequence([new Error("socket closed after upload")]);
    const first = await project.bindTracker(
      { mode: "create" },
      { transport: failed.transport, env: { LINEAR_API_KEY: "linear-secret" } },
    );
    expect(first.tracker).toMatchObject({ health: "failed", failure: { code: "TRACKER_CREATE_AMBIGUOUS" } });
    await expect(project.bindTracker(
      { mode: "create" },
      { transport: failed.transport, env: { LINEAR_API_KEY: "linear-secret" } },
    )).rejects.toEqual(expect.objectContaining<Partial<EmpiricalError>>({ code: "TRACKER_CREATE_CONFIRMATION_REQUIRED" }));
  });
});
