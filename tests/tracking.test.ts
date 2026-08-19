import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EmpiricalProject } from "../src/core.js";
import { EmpiricalError } from "../src/errors.js";
import { digestJson } from "../src/protocol.js";
import {
  createTrackerProjection,
  DISABLED_TRACKER_SETUP,
  discoverTracker,
  loadTrackerSetupState,
  parseTrackerPolicy,
  previewTrackerPolicy,
  proposeTrackerStateMapping,
  suggestTrackerStateMapping,
  trackerProgress,
} from "../src/tracking.js";
import type {
  JiraTrackerPolicy,
  JiraTrackerPolicyV2,
  GitHubTrackerPolicy,
  GitHubTrackerPolicyV2,
  LinearTrackerPolicy,
  LinearTrackerPolicyV2,
  TrackerBindInput,
  TrackerHttpRequest,
  TrackerHttpResponse,
  TrackerOAuthResolver,
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

function linearPolicyV2(
  overrides: Partial<Pick<LinearTrackerPolicyV2, "ticket" | "visibility">> = {},
): LinearTrackerPolicyV2 {
  return {
    schemaVersion: 2,
    provider: "linear",
    target: { teamId: "team-1", projectId: "project-1" },
    credentialEnv: { apiKey: "LINEAR_API_KEY" },
    states: {
      specification: "state-todo",
      planned: "state-todo",
      "in-progress": "state-progress",
      verification: "state-qa",
      review: "state-qa",
      blocked: "state-progress",
      done: "state-done",
    },
    ticket: overrides.ticket ?? "ensure",
    visibility: overrides.visibility ?? "milestones",
  };
}

function linearDiscoveryResponse(statesOverride?: unknown[]) {
  return json(200, {
    data: {
      organization: { id: "workspace-1", name: "Empirical", urlKey: "empirical" },
      teams: {
        nodes: [{
          id: "team-1",
          name: "Engineering",
          key: "ENG",
          projects: {
            nodes: [{ id: "project-1", name: "Empirical", url: "https://linear.app/empirical/project/empirical" }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
          states: {
            nodes: statesOverride ?? [
              { id: "state-todo", name: "Todo", type: "unstarted", position: 0 },
              { id: "state-progress", name: "In Progress", type: "started", position: 1 },
              { id: "state-qa", name: "QA", type: "started", position: 2 },
              { id: "state-done", name: "Done", type: "completed", position: 3 },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        }],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    },
  });
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

function githubPolicyV2(
  overrides: Partial<Pick<GitHubTrackerPolicyV2, "ticket" | "visibility">> = {},
): GitHubTrackerPolicyV2 {
  return {
    ...githubPolicy(),
    schemaVersion: 2,
    states: {
      specification: "todo",
      planned: "todo",
      "in-progress": "doing",
      verification: "qa",
      review: "review",
      blocked: "blocked",
      done: "done",
    },
    ticket: overrides.ticket ?? "ensure",
    visibility: overrides.visibility ?? "milestones",
  };
}

function githubDiscoveryResponse(): TrackerHttpResponse {
  return json(200, { data: { viewer: {
    login: "octocat",
    url: "https://github.com/octocat",
    repositories: {
      nodes: [{
        id: "repo-1",
        name: "empirical-sdd",
        nameWithOwner: "goempirical/empirical-sdd",
        url: "https://github.com/goempirical/empirical-sdd",
        owner: { id: "owner-1", login: "goempirical" },
      }],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
    projectsV2: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
    organizations: {
      nodes: [{
        id: "owner-1",
        login: "goempirical",
        name: "Empirical",
        url: "https://github.com/goempirical",
        projectsV2: {
          nodes: [{
            id: "PVT_project",
            title: "Roadmap",
            url: "https://github.com/orgs/goempirical/projects/1",
            fields: {
              nodes: [{
                id: "PVTSSF_status",
                name: "Status",
                options: [
                  { id: "todo", name: "Todo" },
                  { id: "doing", name: "In Progress" },
                  { id: "qa", name: "QA" },
                  { id: "review", name: "Review" },
                  { id: "blocked", name: "Blocked" },
                  { id: "done", name: "Done" },
                ],
              }],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          }],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      }],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  } } });
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

function jiraPolicyV2(
  overrides: Partial<Pick<JiraTrackerPolicyV2, "ticket" | "visibility">> = {},
): JiraTrackerPolicyV2 {
  return {
    ...jiraPolicy(),
    schemaVersion: 2,
    ticket: overrides.ticket ?? "manual",
    visibility: overrides.visibility ?? "milestones",
  };
}

function jiraDiscoveryResponses(): TrackerHttpResponse[] {
  return [
    json(200, {
      values: [{ id: "10000", key: "ENG", name: "Engineering" }],
      startAt: 0,
      maxResults: 50,
      total: 1,
      isLast: true,
    }),
    json(200, [{ id: "10001", name: "Task" }]),
    json(200, [{
      id: "10001",
      name: "Task",
      statuses: [
        { id: "state-spec", name: "Backlog", statusCategory: { key: "new" } },
        { id: "state-plan", name: "Todo", statusCategory: { key: "new" } },
        { id: "state-work", name: "In Progress", statusCategory: { key: "indeterminate" } },
        { id: "state-verify", name: "QA", statusCategory: { key: "indeterminate" } },
        { id: "state-review", name: "Review", statusCategory: { key: "indeterminate" } },
        { id: "state-blocked", name: "Blocked", statusCategory: { key: "indeterminate" } },
        { id: "state-done", name: "Done", statusCategory: { key: "done" } },
      ],
    }]),
    json(200, [{ id: "summary", key: "summary", name: "Summary" }]),
  ];
}

async function projectWithFastFeature(request = "Add a local tracker fixture") {
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
  const action = await project.fast(request);
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

function linearIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "linear-uuid",
    identifier: "EMP-1",
    url: "https://linear.app/empirical/issue/EMP-1",
    description: "",
    team: { id: "team-1" },
    project: { id: "project-1" },
    ...overrides,
  };
}

function jiraIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "10010",
    key: "ENG-7",
    fields: {
      status: { id: "state-old" },
      project: { key: "ENG" },
      issuetype: { id: "10001" },
    },
    ...overrides,
  };
}

function requestBody(request: TrackerHttpRequest | undefined): Record<string, any> {
  if (!request?.body || typeof request.body !== "string") throw new Error("Expected a JSON request body");
  return JSON.parse(request.body) as Record<string, any>;
}

describe("external ticket tracking", () => {
  test("Linear discovery proposes a complete semantic map and exposes primary-signal ambiguity", async () => {
    const ordinary = sequence([linearDiscoveryResponse()]);
    const discovery = await discoverTracker(
      { provider: "linear", credentialEnv: { apiKey: "LINEAR_API_KEY" } },
      { transport: ordinary.transport, env: { LINEAR_API_KEY: "linear-secret" } },
    );
    expect(discovery.resources.map((resource) => resource.kind)).toEqual([
      "workspace", "team", "project", "state", "state", "state", "state",
    ]);
    const mapping = suggestTrackerStateMapping(discovery);
    expect(mapping.ambiguous).toEqual([]);
    expect(mapping.states).toEqual(linearPolicyV2().states);
    const proposed = await proposeTrackerStateMapping({
      input: { provider: "linear", credentialEnv: { apiKey: "LINEAR_API_KEY" } },
      stateParentId: "team-1",
    }, {
      transport: sequence([linearDiscoveryResponse()]).transport,
      env: { LINEAR_API_KEY: "linear-secret" },
    });
    expect(proposed.states).toEqual(linearPolicyV2().states);

    const tied = sequence([linearDiscoveryResponse([
      { id: "state-a", name: "QA", type: "started", position: 1 },
      { id: "state-b", name: "Review", type: "started", position: 1 },
      { id: "state-todo", name: "Todo", type: "unstarted", position: 0 },
      { id: "state-done", name: "Done", type: "completed", position: 2 },
    ])]);
    const tiedDiscovery = await discoverTracker(
      { provider: "linear", credentialEnv: { apiKey: "LINEAR_API_KEY" } },
      { transport: tied.transport, env: { LINEAR_API_KEY: "linear-secret" } },
    );
    const ambiguous = suggestTrackerStateMapping(tiedDiscovery);
    expect(ambiguous.ambiguous).toContain("verification");
    expect(ambiguous.phases.verification.selectedStateId).toBeNull();
    expect(ambiguous.phases.verification.candidates.slice(0, 2).map((candidate) => candidate.stateId).sort())
      .toEqual(["state-a", "state-b"]);

    const incompatibleTransport = sequence([linearDiscoveryResponse([
      { id: "state-canceled", name: "Canceled", type: "canceled", position: 0 },
    ])]);
    const incompatibleDiscovery = await discoverTracker(
      { provider: "linear", credentialEnv: { apiKey: "LINEAR_API_KEY" } },
      { transport: incompatibleTransport.transport, env: { LINEAR_API_KEY: "linear-secret" } },
    );
    const incompatible = suggestTrackerStateMapping(incompatibleDiscovery);
    expect(incompatible.states).toBeNull();
    expect(incompatible.ambiguous).toEqual([
      "specification", "planned", "in-progress", "verification", "review", "blocked", "done",
    ]);
  });

  test("GitHub Projects and Jira expose the same discovered target hierarchy and capabilities", async () => {
    const github = sequence([json(200, { data: { viewer: {
      login: "octocat",
      url: "https://github.com/octocat",
      repositories: {
        nodes: [{
          id: "repo-1",
          name: "empirical-sdd",
          nameWithOwner: "goempirical/empirical-sdd",
          url: "https://github.com/goempirical/empirical-sdd",
          owner: { id: "owner-1", login: "goempirical" },
        }],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
      projectsV2: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
      organizations: {
        nodes: [{
          id: "owner-1",
          login: "goempirical",
          name: "Empirical",
          url: "https://github.com/goempirical",
          projectsV2: {
            nodes: [{
              id: "project-1",
              title: "Roadmap",
              url: "https://github.com/orgs/goempirical/projects/1",
              fields: {
                nodes: [{ id: "status-1", name: "Status", options: [
                  { id: "todo", name: "Todo" },
                  { id: "doing", name: "In Progress" },
                  { id: "done", name: "Done" },
                ] }],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        }],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    } } })]);
    const githubDiscovery = await discoverTracker(
      { provider: "github", credentialEnv: { token: "GITHUB_TOKEN" } },
      { transport: github.transport, env: { GITHUB_TOKEN: "github-secret" } },
    );
    expect(githubDiscovery.resources.map((resource) => resource.kind)).toEqual([
      "workspace", "workspace", "repository", "project", "field", "state", "state", "state",
    ]);
    expect(githubDiscovery.capabilities).toEqual({ comments: true, uploads: false, durableLinks: true });

    const jira = sequence(jiraDiscoveryResponses());
    const jiraDiscovery = await discoverTracker({
      provider: "jira",
      target: { siteUrl: "https://empirical.atlassian.net" },
      credentialEnv: { email: "JIRA_EMAIL", apiToken: "JIRA_API_TOKEN" },
    }, {
      transport: jira.transport,
      env: { JIRA_EMAIL: "person@example.com", JIRA_API_TOKEN: "jira-secret" },
    });
    expect(jiraDiscovery.resources.map((resource) => resource.kind)).toEqual([
      "workspace", "project", "issue-type", "field",
      "state", "state", "state", "state", "state", "state", "state",
    ]);
    expect(jiraDiscovery.capabilities).toEqual({ comments: true, uploads: true, durableLinks: true });
    expect((await previewTrackerPolicy(jiraPolicyV2(), {
      transport: sequence(jiraDiscoveryResponses()).transport,
      env: { JIRA_EMAIL: "person@example.com", JIRA_API_TOKEN: "jira-secret" },
    })).valid).toBe(true);
  });

  test("OAuth discovery takes precedence and Jira uses the Atlassian Cloud API context", async () => {
    const resolver: TrackerOAuthResolver = {
      resolve: async (request) => {
        if (request.provider === "github") return { provider: "github", accessToken: "oauth-github" };
        if (request.provider === "linear") return { provider: "linear", accessToken: "oauth-linear" };
        return { provider: "jira", accessToken: "oauth-jira", cloudId: "cloud-123" };
      },
    };

    const linear = sequence([linearDiscoveryResponse()]);
    await discoverTracker(
      { provider: "linear", credentialEnv: { apiKey: "LINEAR_SECRET_KEY" } },
      { transport: linear.transport, env: { LINEAR_SECRET_KEY: "environment-linear" }, oauthResolver: resolver },
    );
    expect(linear.calls[0]?.headers.Authorization).toBe("Bearer oauth-linear");
    expect(JSON.stringify(linear.calls)).not.toContain("environment-linear");

    const github = sequence([githubDiscoveryResponse()]);
    await discoverTracker(
      { provider: "github", credentialEnv: { token: "GITHUB_TOKEN" } },
      { transport: github.transport, env: { GITHUB_TOKEN: "environment-github" }, oauthResolver: resolver },
    );
    expect(github.calls[0]?.headers.Authorization).toBe("Bearer oauth-github");
    expect(JSON.stringify(github.calls)).not.toContain("environment-github");

    const jira = sequence(jiraDiscoveryResponses());
    await discoverTracker({
      provider: "jira",
      target: { siteUrl: "https://empirical.atlassian.net" },
      credentialEnv: { email: "JIRA_EMAIL", apiToken: "JIRA_API_TOKEN" },
    }, {
      transport: jira.transport,
      env: { JIRA_EMAIL: "environment@example.com", JIRA_API_TOKEN: "environment-jira" },
      oauthResolver: resolver,
    });
    expect(jira.calls).toHaveLength(4);
    for (const request of jira.calls) {
      expect(request.url).toStartWith("https://api.atlassian.com/ex/jira/cloud-123/rest/api/3/");
      expect(request.headers.Authorization).toBe("Bearer oauth-jira");
    }
    expect(JSON.stringify(jira.calls)).not.toContain("environment@example.com");
    expect(JSON.stringify(jira.calls)).not.toContain("environment-jira");
  });

  test("discovery fails closed on permissions, provider errors, and incomplete nested pagination", async () => {
    let permissionError: unknown;
    try {
      await discoverTracker(
        { provider: "linear", credentialEnv: { apiKey: "LINEAR_API_KEY" } },
        { transport: sequence([json(403, { error: "linear-secret denied" })]).transport, env: { LINEAR_API_KEY: "linear-secret" } },
      );
    } catch (error) {
      permissionError = error;
    }
    expect(permissionError).toMatchObject({ code: "TRACKER_HTTP_FAILED" });
    expect(String((permissionError as Error).message)).not.toContain("linear-secret");

    await expect(discoverTracker(
      { provider: "linear", credentialEnv: { apiKey: "LINEAR_API_KEY" } },
      {
        transport: sequence([json(200, { errors: [{ message: "forbidden" }] })]).transport,
        env: { LINEAR_API_KEY: "linear-secret" },
      },
    )).rejects.toMatchObject({ code: "TRACKER_GRAPHQL_FAILED" });

    const incomplete = linearDiscoveryResponse();
    const body = JSON.parse(incomplete.body) as Record<string, any>;
    body.data.teams.nodes[0].projects.pageInfo = { hasNextPage: true, endCursor: "project-next" };
    await expect(discoverTracker(
      { provider: "linear", credentialEnv: { apiKey: "LINEAR_API_KEY" } },
      {
        transport: sequence([json(200, body)]).transport,
        env: { LINEAR_API_KEY: "linear-secret" },
      },
    )).rejects.toMatchObject({ code: "TRACKER_DISCOVERY_INCOMPLETE" });
  });

  test("Policy v2 ensure creates exactly one Linear ticket and appends one milestone without rewriting descriptions", async () => {
    const { root, project, action } = await projectWithFastFeature();
    const fake = sequence([
      linearDiscoveryResponse(),
      json(200, { data: { issues: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } }),
      json(200, { data: { issueCreate: { success: true, issue: linearIssue() } } }),
      json(200, { data: { issue: linearIssue() } }),
      json(200, { data: { issueUpdate: { success: true, issue: linearIssue() } } }),
      json(200, { data: { issue: { comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } }),
      json(200, { data: { commentCreate: { success: true, comment: { id: "comment-1", body: "created" } } } }),
    ]);
    await project.configureTracker(linearPolicyV2(), {
      transport: fake.transport,
      env: { LINEAR_API_KEY: "linear-secret" },
    });
    const synced = await project.syncTracker({
      transport: fake.transport,
      env: { LINEAR_API_KEY: "linear-secret" },
    });
    expect(synced.tracker).toMatchObject({
      health: "synced",
      schemaVersion: 2,
      ticket: "ensure",
      visibility: "milestones",
      pendingEffects: 0,
    });
    expect(fake.remaining).toHaveLength(0);
    expect(requestBody(fake.calls[2]).variables.input.description).not.toContain("Delivery status");
    expect(requestBody(fake.calls[4]).variables.input).toEqual({ stateId: "state-progress" });
    const milestone = requestBody(fake.calls[6]).variables.input.body as string;
    expect(milestone).toContain(`- Feature: ${action.feature}`);
    expect(milestone).toContain(`- Revision: ${action.revision}`);
    expect(milestone).toContain("- Completion:");
    const binding = JSON.parse(await readFile(
      join(root, ".empirical", "specs", action.feature!, "tracker", "binding.json"),
      "utf8",
    )) as Record<string, any>;
    const pending = JSON.parse(await readFile(
      join(root, ".empirical", "specs", action.feature!, "tracker", "pending.json"),
      "utf8",
    )) as Record<string, any>;
    expect(binding.schemaVersion).toBe(2);
    expect(pending.effects.map((effect: Record<string, string>) => effect.kind)).toEqual(["transition", "comment"]);

    let repeatedRequests = 0;
    expect((await project.syncTracker({
      env: { LINEAR_API_KEY: "linear-secret" },
      transport: async () => {
        repeatedRequests += 1;
        return json(500, {});
      },
    })).tracker.health).toBe("synced");
    expect(repeatedRequests).toBe(0);
  });

  test("Policy v2 GitHub ensure reuses one stable marker and projects each effect once", async () => {
    const { project, action } = await projectWithFastFeature();
    const setup = sequence([githubDiscoveryResponse()]);
    await project.configureTracker(githubPolicyV2(), {
      transport: setup.transport,
      env: { GITHUB_TOKEN: "github-secret" },
    });

    const marker = `empirical-sdd-bind:${action.feature}`;
    const attempt = "a".repeat(64);
    const issue = {
      node_id: "I_kwDO_existing",
      number: 43,
      html_url: "https://github.com/goempirical/empirical-sdd/issues/43",
      body: [
        `<!-- ${marker}:${attempt}:start -->`,
        `Empirical SDD create attempt sha256:${attempt}`,
        `<!-- ${marker}:${attempt}:end -->`,
      ].join("\n"),
    };
    const fake = sequence([
      json(200, [issue]),
      json(200, issue),
      json(200, { data: { node: { projectItems: {
        nodes: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      } } } }),
      json(200, { data: { addProjectV2ItemById: { item: { id: "PVTI_existing" } } } }),
      json(200, { data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_existing" } } } }),
      json(200, []),
      json(201, { id: 991 }),
    ]);
    const result = await project.syncTracker({
      transport: fake.transport,
      env: { GITHUB_TOKEN: "github-secret" },
    });

    expect(result.tracker).toMatchObject({ health: "synced", pendingEffects: 0 });
    expect(result.binding).toMatchObject({ remoteKey: "43", projectItemId: "PVTI_existing" });
    expect(fake.remaining).toHaveLength(0);
    expect(fake.calls[0]?.url).toContain("/issues?state=all");
    expect(fake.calls.some((request) => request.method === "POST" && request.url.endsWith("/issues"))).toBe(false);
    expect(requestBody(fake.calls[4]).variables.option).toBe("doing");
    expect(requestBody(fake.calls[6]).body).toContain("## Empirical milestone");

    let repeatedRequests = 0;
    expect((await project.syncTracker({
      transport: async () => {
        repeatedRequests += 1;
        return json(500, {});
      },
      env: { GITHUB_TOKEN: "github-secret" },
    })).tracker.health).toBe("synced");
    expect(repeatedRequests).toBe(0);
  });

  test("ensure attaches one referenced ticket and stops before provider access on competing references", async () => {
    const referenced = await projectWithFastFeature(
      "Continue https://linear.app/empirical/issue/EMP-42 without creating another ticket",
    );
    const attach = sequence([
      linearDiscoveryResponse(),
      json(200, { data: { issue: linearIssue({ identifier: "EMP-42", url: "https://linear.app/empirical/issue/EMP-42" }) } }),
      json(200, { data: { issue: linearIssue({ identifier: "EMP-42", url: "https://linear.app/empirical/issue/EMP-42" }) } }),
      json(200, { data: { issueUpdate: { success: true, issue: linearIssue({ identifier: "EMP-42", url: "https://linear.app/empirical/issue/EMP-42" }) } } }),
      json(200, { data: { issue: { comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } }),
      json(200, { data: { commentCreate: { success: true, comment: { id: "comment-42", body: "created" } } } }),
    ]);
    await referenced.project.configureTracker(linearPolicyV2(), {
      transport: attach.transport,
      env: { LINEAR_API_KEY: "linear-secret" },
    });
    const attached = await referenced.project.syncTracker({
      transport: attach.transport,
      env: { LINEAR_API_KEY: "linear-secret" },
    });
    expect(attached.binding?.remoteKey).toBe("EMP-42");
    expect(attach.calls.some((request) => request.body && typeof request.body === "string"
      && request.body.includes("issueCreate"))).toBe(false);

    const ambiguous = await projectWithFastFeature(
      "Reconcile https://linear.app/empirical/issue/EMP-1 and https://linear.app/empirical/issue/EMP-2",
    );
    const setup = sequence([linearDiscoveryResponse()]);
    await ambiguous.project.configureTracker(linearPolicyV2(), {
      transport: setup.transport,
      env: { LINEAR_API_KEY: "linear-secret" },
    });
    let providerRequests = 0;
    const stopped = await ambiguous.project.syncTracker({
      transport: async () => {
        providerRequests += 1;
        return json(500, {});
      },
      env: { LINEAR_API_KEY: "linear-secret" },
    });
    expect(stopped.tracker).toMatchObject({
      health: "failed",
      failure: { code: "TRACKER_BIND_AMBIGUOUS" },
    });
    expect(providerRequests).toBe(0);
  });

  test("ensure reconciles one stable feature marker and fails closed on duplicate matches", async () => {
    const existing = await projectWithFastFeature();
    const marker = `empirical-sdd-bind:${existing.action.feature}`;
    const description = [
      `<!-- ${marker}:${"a".repeat(64)}:start -->`,
      `Empirical SDD create attempt sha256:${"a".repeat(64)}`,
      `<!-- ${marker}:${"a".repeat(64)}:end -->`,
    ].join("\n");
    const one = sequence([
      linearDiscoveryResponse(),
      json(200, { data: { issues: {
        nodes: [linearIssue({ description })],
        pageInfo: { hasNextPage: false, endCursor: null },
      } } }),
      json(200, { data: { issue: linearIssue({ description }) } }),
      json(200, { data: { issueUpdate: { success: true, issue: linearIssue({ description }) } } }),
      json(200, { data: { issue: { comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } }),
      json(200, { data: { commentCreate: { success: true, comment: { id: "comment-existing", body: "created" } } } }),
    ]);
    await existing.project.configureTracker(linearPolicyV2(), {
      transport: one.transport,
      env: { LINEAR_API_KEY: "linear-secret" },
    });
    expect((await existing.project.syncTracker({
      transport: one.transport,
      env: { LINEAR_API_KEY: "linear-secret" },
    })).binding?.remoteKey).toBe("EMP-1");
    expect(one.calls.some((request) => typeof request.body === "string" && request.body.includes("issueCreate"))).toBe(false);

    const duplicate = await projectWithFastFeature();
    const duplicateMarker = `empirical-sdd-bind:${duplicate.action.feature}`;
    const duplicateDescription = [
      `<!-- ${duplicateMarker}:${"b".repeat(64)}:start -->`,
      `Empirical SDD create attempt sha256:${"b".repeat(64)}`,
      `<!-- ${duplicateMarker}:${"b".repeat(64)}:end -->`,
    ].join("\n");
    const two = sequence([
      linearDiscoveryResponse(),
      json(200, { data: { issues: {
        nodes: [
          linearIssue({ description: duplicateDescription }),
          linearIssue({
            id: "linear-uuid-2",
            identifier: "EMP-2",
            url: "https://linear.app/empirical/issue/EMP-2",
            description: duplicateDescription,
          }),
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      } } }),
    ]);
    await duplicate.project.configureTracker(linearPolicyV2(), {
      transport: two.transport,
      env: { LINEAR_API_KEY: "linear-secret" },
    });
    expect((await duplicate.project.syncTracker({
      transport: two.transport,
      env: { LINEAR_API_KEY: "linear-secret" },
    })).tracker).toMatchObject({
      health: "failed",
      failure: { code: "TRACKER_BIND_AMBIGUOUS" },
    });
    expect(two.remaining).toHaveLength(0);
  });

  test("a lost milestone response is reconciled by marker without repeating acknowledged effects", async () => {
    const { root, project, action } = await projectWithFastFeature();
    const first = sequence([
      linearDiscoveryResponse(),
      json(200, { data: { issues: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } }),
      json(200, { data: { issueCreate: { success: true, issue: linearIssue() } } }),
      json(200, { data: { issue: linearIssue() } }),
      json(200, { data: { issueUpdate: { success: true, issue: linearIssue() } } }),
      json(200, { data: { issue: { comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } }),
      new Error("connection closed after Linear accepted the comment"),
    ]);
    await project.configureTracker(linearPolicyV2(), {
      transport: first.transport,
      env: { LINEAR_API_KEY: "linear-secret" },
    });
    expect((await project.syncTracker({
      transport: first.transport,
      env: { LINEAR_API_KEY: "linear-secret" },
    })).tracker.health).toBe("failed");
    const pendingPath = join(root, ".empirical", "specs", action.feature!, "tracker", "pending.json");
    const interrupted = JSON.parse(await readFile(pendingPath, "utf8")) as Record<string, any>;
    expect(interrupted.effects.map((effect: Record<string, string>) => effect.kind)).toEqual(["transition"]);
    const postedMilestone = requestBody(first.calls.at(-1)).variables.input.body as string;

    const retry = sequence([json(200, { data: { issue: { comments: {
      nodes: [{ id: "comment-recovered", body: postedMilestone }],
      pageInfo: { hasNextPage: false, endCursor: null },
    } } } })]);
    const recovered = await project.syncTracker({
      transport: retry.transport,
      env: { LINEAR_API_KEY: "linear-secret" },
    });
    expect(recovered.tracker).toMatchObject({ health: "synced", pendingEffects: 0 });
    expect(retry.calls).toHaveLength(1);
    expect(requestBody(retry.calls[0]).query).toContain("Milestones");
    const acknowledged = JSON.parse(await readFile(pendingPath, "utf8")) as Record<string, any>;
    expect(acknowledged.effects.map((effect: Record<string, string>) => effect.kind)).toEqual(["transition", "comment"]);
  });

  test("receipt-approved Jira evidence through an aliased root uploads once and recovers a lost response", async () => {
    const { root, project, action } = await projectWithFastFeature();
    const artifactBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await writeFile(join(root, "review.png"), artifactBytes);
    const receipt = await project.collectEvidence({
      criteria: [action.acceptanceCriteria[0]!.id],
      evidenceKinds: ["screenshot"],
      summary: "Review screenshot",
      collector: "tracking-test",
      artifacts: [{ path: "review.png", mediaType: "image/png" }],
    });
    await project.complete({
      revision: action.revision,
      outcome: "passed",
      summary: "Implementation committed with review evidence",
      receiptIds: [receipt.id],
    });
    const aliasedRoot = `${root}-alias`;
    await symlink(root, aliasedRoot, process.platform === "win32" ? "junction" : "dir");
    directories.push(aliasedRoot);
    expect(await realpath(aliasedRoot)).not.toBe(aliasedRoot);
    const aliasedProject = await EmpiricalProject.open(aliasedRoot, { feature: action.feature! });
    const committedState = await project.statusReport();
    const desiredState = jiraPolicyV2().states[trackerProgress(committedState)];

    const discovery = sequence(jiraDiscoveryResponses());
    await aliasedProject.configureTracker(jiraPolicyV2(), {
      transport: discovery.transport,
      env: { JIRA_EMAIL: "person@example.com", JIRA_API_TOKEN: "jira-secret" },
    });
    const issueWithStatus = jiraIssue({ fields: {
      status: { id: desiredState },
      project: { key: "ENG" },
      issuetype: { id: "10001" },
    } });
    const first = sequence([
      json(200, issueWithStatus),
      json(200, issueWithStatus),
      json(204, {}),
      json(200, { comments: [], total: 0 }),
      json(201, { id: "jira-comment-1" }),
      json(200, jiraIssue({ fields: {
        status: { id: desiredState },
        project: { key: "ENG" },
        issuetype: { id: "10001" },
        attachment: [],
      } })),
      new Error("connection closed after Jira accepted the attachment"),
    ]);
    const interrupted = await aliasedProject.bindTracker(
      { mode: "attach", ticket: "ENG-7" },
      {
        transport: first.transport,
        env: { JIRA_EMAIL: "person@example.com", JIRA_API_TOKEN: "jira-secret" },
      },
    );
    expect(interrupted.tracker).toMatchObject({ health: "failed", pendingEffects: 1 });
    const uploadRequest = first.calls.at(-1)!;
    expect(uploadRequest.url).toEndWith("/attachments");
    expect(uploadRequest.body).toBeInstanceOf(Uint8Array);
    const multipart = Buffer.from(uploadRequest.body as Uint8Array).toString("latin1");
    const filename = /filename="([^"]+)"/.exec(multipart)?.[1];
    expect(filename).toStartWith("empirical-");
    expect(Buffer.from(uploadRequest.body as Uint8Array).includes(artifactBytes)).toBe(true);
    const pendingPath = join(root, ".empirical", "specs", action.feature!, "tracker", "pending.json");
    const partial = JSON.parse(await readFile(pendingPath, "utf8")) as Record<string, any>;
    expect(partial.effects.map((effect: Record<string, string>) => effect.kind)).toEqual(["transition", "comment"]);

    const retry = sequence([json(200, jiraIssue({ fields: {
      status: { id: desiredState },
      project: { key: "ENG" },
      issuetype: { id: "10001" },
      attachment: [{ id: "attachment-1", filename, size: artifactBytes.length, mimeType: "image/png" }],
    } }))]);
    const recovered = await aliasedProject.syncTracker({
      transport: retry.transport,
      env: { JIRA_EMAIL: "person@example.com", JIRA_API_TOKEN: "jira-secret" },
    });
    expect(recovered.tracker).toMatchObject({ health: "synced", pendingEffects: 0 });
    expect(retry.calls).toHaveLength(1);
    const complete = JSON.parse(await readFile(pendingPath, "utf8")) as Record<string, any>;
    expect(complete.effects.map((effect: Record<string, string>) => effect.kind)).toEqual([
      "transition", "comment", "artifact",
    ]);
    expect(complete.effects.at(-1).remoteId).toBe("attachment-1");
  });

  test("unsafe receipt artifacts fail before any synchronization request", async () => {
    const { root, project, action } = await projectWithFastFeature();
    await writeFile(join(root, ".env.capture.png"), Buffer.from("not a secret, but a secret-like path"));
    const receipt = await project.collectEvidence({
      criteria: [action.acceptanceCriteria[0]!.id],
      evidenceKinds: ["screenshot"],
      summary: "Unsafe path fixture",
      collector: "tracking-test",
      artifacts: [{ path: ".env.capture.png", mediaType: "image/png" }],
    });
    await project.complete({
      revision: action.revision,
      outcome: "passed",
      summary: "Local state remains authoritative",
      receiptIds: [receipt.id],
    });
    const discovery = sequence([linearDiscoveryResponse()]);
    await project.configureTracker(linearPolicyV2({ ticket: "manual" }), {
      transport: discovery.transport,
      env: { LINEAR_API_KEY: "linear-secret" },
    });
    let requests = 0;
    const failed = await project.syncTracker({
      transport: async () => {
        requests += 1;
        return json(500, {});
      },
      env: { LINEAR_API_KEY: "linear-secret" },
    });
    expect(failed.tracker).toMatchObject({
      health: "failed",
      failure: { code: "TRACKER_ARTIFACT_UNSAFE" },
    });
    expect(requests).toBe(0);
  });

  test("disabled and off tracking branch before credentials and provider access", async () => {
    const { project } = await projectWithFastFeature();
    let requests = 0;
    await project.configureTracker(null, {
      transport: async () => {
        requests += 1;
        return json(500, {});
      },
    });
    expect((await project.syncTracker({
      transport: async () => {
        requests += 1;
        return json(500, {});
      },
    })).tracker.health).toBe("local-only");
    expect(requests).toBe(0);

    const setup = sequence([linearDiscoveryResponse()]);
    await project.configureTracker(linearPolicyV2({ ticket: "off" }), {
      transport: setup.transport,
      env: { LINEAR_API_KEY: "linear-secret" },
    });
    let offRequests = 0;
    expect((await project.syncTracker({
      transport: async () => {
        offRequests += 1;
        return json(500, {});
      },
    })).tracker).toMatchObject({ health: "off", ticket: "off", schemaVersion: 2 });
    expect(offRequests).toBe(0);
  });

  test("repair preserves tracker bytes by default and explicit disable performs no provider request", async () => {
    const { root, project } = await projectWithFastFeature();
    await project.configureTracker(linearPolicy());
    const policyPath = join(root, ".empirical", "tracker.json");
    const before = await readFile(policyPath, "utf8");
    let requests = 0;
    await EmpiricalProject.initialize(root, {
      integrations: false,
      setupComplete: true,
      tracker: { mode: "preserve" },
      trackerDependencies: {
        transport: async () => {
          requests += 1;
          return json(500, {});
        },
      },
    });
    expect(await readFile(policyPath, "utf8")).toBe(before);
    expect(requests).toBe(0);

    await EmpiricalProject.initialize(root, {
      integrations: false,
      setupComplete: true,
      tracker: { mode: "disabled" },
      trackerDependencies: {
        transport: async () => {
          requests += 1;
          return json(500, {});
        },
      },
    });
    expect(JSON.parse(await readFile(policyPath, "utf8"))).toEqual(DISABLED_TRACKER_SETUP);
    expect(await loadTrackerSetupState(root)).toEqual({ mode: "disabled", policy: null });
    expect(requests).toBe(0);

    const disabledBefore = await readFile(policyPath, "utf8");
    await EmpiricalProject.initialize(root, {
      integrations: false,
      setupComplete: true,
      tracker: { mode: "preserve" },
      trackerDependencies: {
        transport: async () => {
          requests += 1;
          return json(500, {});
        },
      },
    });
    expect(await readFile(policyPath, "utf8")).toBe(disabledBefore);
    expect(requests).toBe(0);
  });

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
    await project.configureTracker(linearPolicy());
    await project.configureTracker(null);
    expect((await project.statusReport()).tracker.health).toBe("local-only");
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

  test("v2 access validation happens before replacing an existing policy", async () => {
    const { root, project } = await projectWithFastFeature();
    await project.configureTracker(linearPolicy());
    const path = join(root, ".empirical", "tracker.json");
    const before = await readFile(path, "utf8");
    await expect(project.configureTracker(linearPolicyV2(), {
      transport: sequence([json(403, { error: "denied" })]).transport,
      env: { LINEAR_API_KEY: "linear-secret" },
    })).rejects.toMatchObject({ code: "TRACKER_HTTP_FAILED" });
    expect(await readFile(path, "utf8")).toBe(before);
  });

  test("initialization validates an applied tracker before creating project state", async () => {
    const root = await mkdtemp(join(tmpdir(), "empirical-tracker-preflight-"));
    directories.push(root);
    await expect(EmpiricalProject.initialize(root, {
      integrations: false,
      setupComplete: true,
      tracker: { mode: "apply", policy: linearPolicyV2() },
      trackerDependencies: {
        transport: sequence([json(403, { error: "denied" })]).transport,
        env: { LINEAR_API_KEY: "linear-secret" },
      },
    })).rejects.toMatchObject({ code: "TRACKER_HTTP_FAILED" });
    expect(await Bun.file(join(root, ".empirical", "config.json")).exists()).toBe(false);
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
    expect(() => createTrackerProjection({ ...base, activeFeature: null } as WorkflowState))
      .toThrow("requires an active feature");
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

  test("project tracker operations cannot override the repository secret-file boundary", async () => {
    const { root, project } = await projectWithFastFeature();
    await project.configureTracker(linearPolicy());
    const inside = join(root, "tracker-secrets.env");
    await writeFile(inside, "LINEAR_API_KEY=must-stay-outside\n", { mode: 0o600 });
    let requests = 0;
    const result = await project.bindTracker({ mode: "attach", ticket: "EMP-2" }, {
      env: {},
      secretFilePath: inside,
      repositoryRoot: tmpdir(),
      transport: async () => {
        requests += 1;
        return json(200, {});
      },
    });
    expect(requests).toBe(0);
    expect(result.tracker.failure?.code).toBe("TRACKER_SECRET_FILE_IN_REPOSITORY");
  });

  test("status distinguishes synchronized, unresolved replacement, and target-drift records", async () => {
    const { root, project, action } = await projectWithFastFeature();
    await project.configureTracker(linearPolicy());
    const initial = sequence([
      json(200, { data: { issue: linearIssue() } }),
      json(200, { data: { issue: linearIssue() } }),
      json(200, { data: { issueUpdate: { success: true, issue: linearIssue() } } }),
    ]);
    expect((await project.bindTracker(
      { mode: "attach", ticket: "EMP-1" },
      { transport: initial.transport, env: { LINEAR_API_KEY: "linear-secret" } },
    )).tracker.health).toBe("synced");
    expect((await project.statusReport()).tracker).toMatchObject({
      health: "synced",
      provider: "linear",
      url: "https://linear.app/empirical/issue/EMP-1",
      pendingRevision: null,
    });

    const unavailable = sequence([{ status: 503, body: "replacement unavailable" }]);
    await project.bindTracker(
      { mode: "attach", ticket: "EMP-1", replace: true },
      { transport: unavailable.transport, env: { LINEAR_API_KEY: "linear-secret" } },
    );
    expect((await project.statusReport()).tracker).toMatchObject({
      health: "failed",
      provider: "linear",
      url: null,
      failure: { code: "TRACKER_HTTP_FAILED" },
    });

    const pendingPath = join(root, ".empirical", "specs", action.feature!, "tracker", "pending.json");
    const stored = JSON.parse(await readFile(pendingPath, "utf8")) as Record<string, any>;
    const { digest: _digest, ...pendingBody } = stored;
    const retryableBody = {
      ...pendingBody,
      status: "pending",
      failure: null,
      updatedAt: "2026-08-11T16:00:00.000Z",
    };
    await writeFile(pendingPath, `${JSON.stringify({
      ...retryableBody,
      digest: digestJson(retryableBody),
    }, null, 2)}\n`, "utf8");
    expect((await project.statusReport()).tracker).toMatchObject({
      health: "pending",
      provider: "linear",
      url: null,
      pendingRevision: action.revision,
      failure: null,
    });

    const offTargetBody = {
      ...retryableBody,
      targetDigest: digestJson({ provider: "linear", target: "other" }),
    };
    await writeFile(pendingPath, `${JSON.stringify({
      ...offTargetBody,
      digest: digestJson(offTargetBody),
    }, null, 2)}\n`, "utf8");
    expect((await project.statusReport()).tracker).toMatchObject({
      health: "failed",
      provider: "linear",
      url: null,
      failure: { code: "TRACKER_TARGET_MISMATCH" },
    });

    await rm(pendingPath);
    const bindingPath = join(root, ".empirical", "specs", action.feature!, "tracker", "binding.json");
    const storedBinding = JSON.parse(await readFile(bindingPath, "utf8")) as Record<string, any>;
    const { digest: _bindingDigest, ...bindingBody } = storedBinding;
    const wrongProviderBody = {
      ...bindingBody,
      provider: "github",
      remoteId: "I_wrong_provider",
      remoteKey: "1",
      url: "https://github.com/goempirical/empirical-sdd/issues/1",
      projectItemId: null,
      markerId: null,
    };
    await writeFile(bindingPath, `${JSON.stringify({
      ...wrongProviderBody,
      digest: digestJson(wrongProviderBody),
    }, null, 2)}\n`, "utf8");
    expect((await project.statusReport()).tracker).toMatchObject({
      health: "failed",
      provider: "linear",
      url: null,
      failure: { code: "TRACKER_PROVIDER_MISMATCH" },
    });

    await writeFile(bindingPath, `${JSON.stringify({
      ...wrongProviderBody,
      digest: `sha256:${"0".repeat(64)}`,
    }, null, 2)}\n`, "utf8");
    expect((await project.statusReport()).tracker).toMatchObject({
      health: "failed",
      provider: "linear",
      url: null,
      failure: { code: "INVALID_TRACKER_DIGEST" },
    });
  });

  test("status reports prepared no-binding work and rejects its later target drift", async () => {
    const { root, project, action } = await projectWithFastFeature();
    await project.configureTracker(linearPolicy());
    expect((await project.bindTracker({ mode: "create" }, { env: {} })).tracker)
      .toMatchObject({ health: "failed", failure: { code: "TRACKER_CREDENTIAL_MISSING" } });

    const pendingPath = join(root, ".empirical", "specs", action.feature!, "tracker", "pending.json");
    const stored = JSON.parse(await readFile(pendingPath, "utf8")) as Record<string, any>;
    const { digest: _digest, ...pendingBody } = stored;
    const preparedBody = {
      ...pendingBody,
      status: "pending",
      failure: null,
      updatedAt: "2026-08-11T16:01:00.000Z",
    };
    await writeFile(pendingPath, `${JSON.stringify({
      ...preparedBody,
      digest: digestJson(preparedBody),
    }, null, 2)}\n`, "utf8");
    expect((await project.statusReport()).tracker).toMatchObject({
      health: "pending",
      provider: "linear",
      url: null,
      pendingRevision: action.revision,
      failure: null,
    });

    await project.configureTracker({
      ...linearPolicy(),
      target: { teamId: "team-2", projectId: "project-2" },
    });
    expect((await project.statusReport()).tracker).toMatchObject({
      health: "failed",
      provider: "linear",
      url: null,
      failure: { code: "TRACKER_TARGET_MISMATCH" },
    });
    await writeFile(join(root, ".empirical", "tracker.json"), "{}\n", "utf8");
    expect((await project.statusReport()).tracker).toMatchObject({
      health: "failed",
      provider: null,
      url: null,
      failure: { code: "INVALID_TRACKER_POLICY" },
    });
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
      json(200, { data: { issueCreate: { success: true, issue: linearIssue() } } }),
      json(200, { data: { issue: linearIssue({ description: "User description" }) } }),
      json(200, { data: { issueUpdate: { success: true, issue: linearIssue() } } }),
      json(200, { data: { issue: linearIssue({ description: "User description" }) } }),
      json(200, { data: { issueUpdate: { success: true, issue: linearIssue() } } }),
    ]);
    const bound = await project.bindTracker(
      { mode: "create", title: "External ticket tracking" },
      { transport: fake.transport, env: { LINEAR_API_KEY: "linear-secret" }, now: () => new Date("2026-08-09T12:00:00.000Z") },
    );
    expect(bound.tracker).toMatchObject({ health: "synced", provider: "linear", lastSyncedRevision: 1 });
    expect(fake.calls[0]).toMatchObject({ method: "POST", url: "https://api.linear.app/graphql" });
    expect(fake.calls[0]?.headers.Authorization).toBe("linear-secret");
    const createdDescription = requestBody(fake.calls[0]).variables.input.description as string;
    expect(createdDescription).toContain("## [Delivery status]");
    expect(createdDescription).toContain("[Crash-safe synchronization enabled]");
    expect(createdDescription).toContain("- Phase: Implement");
    expect(createdDescription).toContain("- Workflow: Waiting");
    expect(createdDescription).toContain("- Completion: Not complete");
    expect(createdDescription).toContain("sha256:");
    expect(createdDescription).not.toContain("<!--");
    expect(createdDescription).not.toContain("Empirical SDD create attempt");
    expect(fake.calls[2]?.body).toContain("empirical-sdd:add-a-local-tracker-fixture:r1");
    expect(fake.calls[2]?.body).toContain("User description");
    let duplicateBindRequests = 0;
    const noDuplicateTransport: TrackerTransport = async () => {
      duplicateBindRequests += 1;
      return json(500, {});
    };
    expect((await project.bindTracker(
      { mode: "attach", ticket: "EMP-1" },
      { transport: noDuplicateTransport, env: { LINEAR_API_KEY: "linear-secret" } },
    )).binding).toMatchObject({ remoteKey: "EMP-1" });
    await expect(project.bindTracker(
      { mode: "attach", ticket: "EMP-99" },
      { transport: noDuplicateTransport, env: { LINEAR_API_KEY: "linear-secret" } },
    )).rejects.toMatchObject({ code: "TRACKER_ALREADY_BOUND" });
    expect(duplicateBindRequests).toBe(0);

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

  test("Linear migrates one legacy projection and recovery block without exposing machine metadata", async () => {
    const { project } = await projectWithFastFeature();
    await project.configureTracker(linearPolicy());
    const feature = "add-a-local-tracker-fixture";
    const attempt = "a".repeat(64);
    const legacyDescription = [
      "Human introduction",
      "",
      `<!-- empirical-sdd:${feature}:start -->`,
      "Empirical SDD · implement/waiting · revision 1",
      "Progress: in-progress · completion: none",
      `Marker: empirical-sdd:${feature}:r1`,
      `<!-- empirical-sdd:${feature}:end -->`,
      "",
      "Human conclusion",
      "",
      `<!-- empirical-sdd-bind:${feature}:${attempt}:start -->`,
      `Empirical SDD create attempt sha256:${attempt}`,
      `<!-- empirical-sdd-bind:${feature}:${attempt}:end -->`,
    ].join("\n");
    const issue = linearIssue({ description: legacyDescription });
    const fake = sequence([
      json(200, { data: { issue } }),
      json(200, { data: { issue } }),
      json(200, { data: { issueUpdate: { success: true, issue: linearIssue() } } }),
    ]);
    const result = await project.bindTracker(
      { mode: "attach", ticket: "EMP-1" },
      { transport: fake.transport, env: { LINEAR_API_KEY: "linear-secret" } },
    );
    expect(result.tracker.health).toBe("synced");
    const migrated = requestBody(fake.calls[2]).variables.input.description as string;
    expect(migrated).toContain("Human introduction");
    expect(migrated).toContain("Human conclusion");
    expect(migrated).toContain("## [Delivery status]");
    expect(migrated).toContain("[Crash-safe synchronization enabled]");
    expect(migrated).toContain(`sha256:${attempt}`);
    expect(migrated).not.toContain("<!--");
    expect(migrated).not.toContain("Empirical SDD create attempt");

    const mixedProject = await projectWithFastFeature();
    await mixedProject.project.configureTracker(linearPolicy());
    const mixedDescription = `${legacyDescription}\n\n[**Empirical SDD**](https://github.com/goempirical/empirical-sdd#empirical-sdd:${feature}:start)`;
    const mixedIssue = linearIssue({ description: mixedDescription });
    const mixed = sequence([
      json(200, { data: { issue: mixedIssue } }),
      json(200, { data: { issue: mixedIssue } }),
    ]);
    const rejected = await mixedProject.project.bindTracker(
      { mode: "attach", ticket: "EMP-1" },
      { transport: mixed.transport, env: { LINEAR_API_KEY: "linear-secret" } },
    );
    expect(rejected.tracker).toMatchObject({ health: "failed", failure: { code: "TRACKER_MARKER_AMBIGUOUS" } });
    expect(mixed.calls).toHaveLength(2);

    const malformedProject = await projectWithFastFeature();
    await malformedProject.project.configureTracker(linearPolicy());
    const malformedDescription = [
      "Human text",
      `<!-- empirical-sdd-bind:${feature}:${attempt}:start -->`,
      "tampered recovery body",
      `<!-- empirical-sdd-bind:${feature}:${attempt}:end -->`,
    ].join("\n");
    const malformedIssue = linearIssue({ description: malformedDescription });
    const malformed = sequence([
      json(200, { data: { issue: malformedIssue } }),
      json(200, { data: { issue: malformedIssue } }),
    ]);
    const malformedResult = await malformedProject.project.bindTracker(
      { mode: "attach", ticket: "EMP-1" },
      { transport: malformed.transport, env: { LINEAR_API_KEY: "linear-secret" } },
    );
    expect(malformedResult.tracker).toMatchObject({ health: "failed", failure: { code: "TRACKER_MARKER_AMBIGUOUS" } });
    expect(malformed.calls).toHaveLength(2);

    const malformedLinkProject = await projectWithFastFeature();
    await malformedLinkProject.project.configureTracker(linearPolicy());
    const malformedLinkIssue = linearIssue({
      description: `[Recovery reference](https://github.com/goempirical/empirical-sdd#empirical-sdd-bind:${feature}:sha256:not-a-digest)`,
    });
    const malformedLink = sequence([
      json(200, { data: { issue: malformedLinkIssue } }),
      json(200, { data: { issue: malformedLinkIssue } }),
    ]);
    const malformedLinkResult = await malformedLinkProject.project.bindTracker(
      { mode: "attach", ticket: "EMP-1" },
      { transport: malformedLink.transport, env: { LINEAR_API_KEY: "linear-secret" } },
    );
    expect(malformedLinkResult.tracker).toMatchObject({ health: "failed", failure: { code: "TRACKER_MARKER_AMBIGUOUS" } });
    expect(malformedLink.calls).toHaveLength(2);
  });

  test("GitHub create keeps exactly one machine-owned marker in the project comment", async () => {
    const { project } = await projectWithFastFeature();
    await project.configureTracker(githubPolicy());
    const fake = sequence([
      json(201, { node_id: "I_kwDO_created", number: 43, html_url: "https://github.com/goempirical/empirical-sdd/issues/43" }),
      json(200, { node_id: "I_kwDO_created", number: 43, html_url: "https://github.com/goempirical/empirical-sdd/issues/43" }),
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
    expect(fake.calls[0]?.body).toContain("empirical-sdd-bind:add-a-local-tracker-fixture");
    expect(fake.calls[4]?.method).toBe("GET");
    expect(fake.calls[5]?.body).toContain("empirical-sdd:add-a-local-tracker-fixture:start");
  });

  test("GitHub attachment adopts an existing Projects v2 item, upserts one comment, and moves Status", async () => {
    const { project } = await projectWithFastFeature();
    await project.configureTracker(githubPolicy());
    const fake = sequence([
      json(200, { node_id: "I_kwDO_issue", number: 42, html_url: "https://github.com/goempirical/empirical-sdd/issues/42" }),
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
    expect(fake.calls.map(({ method }) => method)).toEqual(["GET", "GET", "POST", "GET", "PATCH", "POST"]);
    expect(fake.calls[2]?.body).toContain("projectItems(first: 100");
    expect(fake.calls[3]?.url).toContain("/issues/42/comments?per_page=100&page=1");
    expect(fake.calls[4]?.url).toEndWith("/issues/comments/987");
    expect(fake.calls[5]?.body).toContain("updateProjectV2ItemFieldValue");
  });

  test("Jira attachment writes the issue property and selects a transition by destination status", async () => {
    const { project } = await projectWithFastFeature();
    const policy = jiraPolicy();
    await project.configureTracker(policy);
    const desired = policy.states["in-progress"];
    const fake = sequence([
      json(200, jiraIssue()),
      json(200, jiraIssue()),
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
      json(200, { data: { issue: linearIssue({ identifier: "EMP-9", url: "https://linear.app/empirical/issue/EMP-9" }) } }),
      json(200, { data: { issue: linearIssue({ identifier: "EMP-9", url: "https://linear.app/empirical/issue/EMP-9" }) } }),
      json(200, { data: { issueUpdate: { success: true, issue: linearIssue({ identifier: "EMP-9", url: "https://linear.app/empirical/issue/EMP-9" }) } } }),
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

  test("bind input is a strict runtime discriminated union before pending mutation", async () => {
    const { root, project, action } = await projectWithFastFeature();
    await project.configureTracker(linearPolicy());
    let requests = 0;
    const invalid: unknown[] = [
      { mode: "bogus", ticket: "EMP-1" },
      { mode: "create", ticket: "EMP-1" },
      { mode: "attach", ticket: "EMP-1", title: "ignored" },
      { mode: "attach", ticket: "EMP-1", description: "ignored" },
      { mode: "attach", ticket: "EMP-1", confirmCreateRetry: true },
      { mode: "create", unexpected: true },
      { mode: "create", description: "Authorization: Bearer credential-must-not-enter-tools" },
    ];
    for (const input of invalid) {
      await expect(project.bindTracker(input as TrackerBindInput, {
        env: { LINEAR_API_KEY: "linear-secret" },
        transport: async () => {
          requests += 1;
          return json(500, {});
        },
      })).rejects.toEqual(expect.objectContaining<Partial<EmpiricalError>>({ code: "INVALID_TRACKER_BIND_INPUT" }));
    }
    expect(requests).toBe(0);
    expect(await Bun.file(join(root, ".empirical", "specs", action.feature!, "tracker", "pending.json")).exists()).toBe(false);
  });

  test("all uncertain create responses become durable ambiguity after dispatch", async () => {
    const variants: Array<TrackerHttpResponse | Error> = [
      { status: 200, body: "{" },
      { status: 502, body: "provider failure" },
      json(200, { errors: [{ message: "unknown create outcome" }] }),
      { status: 200, body: "x".repeat(1_048_577) },
    ];
    for (const response of variants) {
      const { root, project, action } = await projectWithFastFeature();
      await project.configureTracker(linearPolicy());
      const fake = sequence([response]);
      const result = await project.bindTracker(
        { mode: "create" },
        { transport: fake.transport, env: { LINEAR_API_KEY: "linear-secret" } },
      );
      expect(result.tracker).toMatchObject({
        health: "failed",
        failure: { code: "TRACKER_CREATE_AMBIGUOUS" },
      });
      expect(fake.calls).toHaveLength(1);
      const pending = JSON.parse(await readFile(
        join(root, ".empirical", "specs", action.feature!, "tracker", "pending.json"),
        "utf8",
      )) as Record<string, any>;
      expect(pending).toMatchObject({ intent: { mode: "create", dispatched: true } });
      expect(requestBody(fake.calls[0]).variables.input.description).toContain(pending.idempotencyKey);
    }
  });

  test("sync retries a durable no-binding attach intent", async () => {
    const { root, project, action } = await projectWithFastFeature();
    await project.configureTracker(linearPolicy());
    const first = sequence([{ status: 503, body: "unavailable" }]);
    const failed = await project.bindTracker(
      { mode: "attach", ticket: "EMP-3" },
      { transport: first.transport, env: { LINEAR_API_KEY: "linear-secret" } },
    );
    expect(failed).toMatchObject({ binding: null, tracker: { health: "failed" } });
    const pendingPath = join(root, ".empirical", "specs", action.feature!, "tracker", "pending.json");
    expect(JSON.parse(await readFile(pendingPath, "utf8"))).toMatchObject({ intent: { mode: "attach", ticket: "EMP-3" } });

    const issue = linearIssue({ id: "linear-3", identifier: "EMP-3", url: "https://linear.app/empirical/issue/EMP-3" });
    const retry = sequence([
      json(200, { data: { issue } }),
      json(200, { data: { issue } }),
      json(200, { data: { issueUpdate: { success: true, issue } } }),
    ]);
    const synced = await project.syncTracker({
      transport: retry.transport,
      env: { LINEAR_API_KEY: "linear-secret" },
    });
    expect(synced.tracker).toMatchObject({ health: "synced", lastSyncedRevision: 1 });
    expect(synced.binding).toMatchObject({ remoteId: "linear-3", remoteKey: "EMP-3" });
    expect(retry.remaining).toHaveLength(0);
  });

  test("a projection failure after create keeps the durable binding and is not ambiguous", async () => {
    const { project } = await projectWithFastFeature();
    await project.configureTracker(linearPolicy());
    const first = sequence([
      json(200, { data: { issueCreate: { success: true, issue: linearIssue() } } }),
      { status: 503, body: "projection unavailable" },
    ]);
    const failed = await project.bindTracker(
      { mode: "create" },
      { transport: first.transport, env: { LINEAR_API_KEY: "linear-secret" } },
    );
    expect(failed.binding).toMatchObject({ remoteId: "linear-uuid", lastSyncedRevision: null });
    expect(failed.tracker).toMatchObject({ health: "failed", failure: { code: "TRACKER_HTTP_FAILED" } });
    expect((await project.statusReport()).tracker).toMatchObject({
      health: "failed",
      provider: "linear",
      url: "https://linear.app/empirical/issue/EMP-1",
      lastSyncedRevision: null,
      failure: { code: "TRACKER_HTTP_FAILED" },
    });

    const retry = sequence([
      json(200, { data: { issue: linearIssue() } }),
      json(200, { data: { issueUpdate: { success: true, issue: linearIssue() } } }),
    ]);
    const synced = await project.syncTracker({ transport: retry.transport, env: { LINEAR_API_KEY: "linear-secret" } });
    expect(synced.tracker.health).toBe("synced");
    expect([...first.calls, ...retry.calls].filter((call) => call.body?.includes("issueCreate(input"))).toHaveLength(1);
  });

  test("same-provider target drift fails closed while state-map drift forces a request", async () => {
    const { project } = await projectWithFastFeature();
    await project.configureTracker(linearPolicy());
    const initial = sequence([
      json(200, { data: { issue: linearIssue() } }),
      json(200, { data: { issue: linearIssue() } }),
      json(200, { data: { issueUpdate: { success: true, issue: linearIssue() } } }),
    ]);
    expect((await project.bindTracker(
      { mode: "attach", ticket: "EMP-1" },
      { transport: initial.transport, env: { LINEAR_API_KEY: "linear-secret" } },
    )).tracker.health).toBe("synced");

    await project.configureTracker({
      ...linearPolicy(),
      target: { teamId: "team-2", projectId: "project-2" },
    });
    expect((await project.statusReport()).tracker).toMatchObject({
      health: "failed",
      failure: { code: "TRACKER_TARGET_MISMATCH" },
    });
    let driftRequests = 0;
    const drift = await project.syncTracker({
      env: { LINEAR_API_KEY: "linear-secret" },
      transport: async () => {
        driftRequests += 1;
        return json(500, {});
      },
    });
    expect(drift.tracker.failure?.code).toBe("TRACKER_TARGET_MISMATCH");
    expect(driftRequests).toBe(0);

    await project.configureTracker({
      ...linearPolicy(),
      states: { ...states, "in-progress": "state-work-v2" },
    });
    expect((await project.statusReport()).tracker.health).toBe("pending");
    const policySync = sequence([
      json(200, { data: { issue: linearIssue() } }),
      json(200, { data: { issueUpdate: { success: true, issue: linearIssue() } } }),
    ]);
    expect((await project.syncTracker({
      transport: policySync.transport,
      env: { LINEAR_API_KEY: "linear-secret" },
    })).tracker.health).toBe("synced");
    expect(requestBody(policySync.calls[1]).variables.input.stateId).toBe("state-work-v2");
    let repeatRequests = 0;
    expect((await project.syncTracker({
      env: { LINEAR_API_KEY: "linear-secret" },
      transport: async () => {
        repeatRequests += 1;
        return json(500, {});
      },
    })).tracker.health).toBe("synced");
    expect(repeatRequests).toBe(0);
  });

  test("Linear and Jira attachments reject tickets outside the configured target", async () => {
    const linear = await projectWithFastFeature();
    await linear.project.configureTracker(linearPolicy());
    const wrongLinear = sequence([
      json(200, { data: { issue: linearIssue({ team: { id: "team-2" } }) } }),
    ]);
    const linearResult = await linear.project.bindTracker(
      { mode: "attach", ticket: "EMP-1" },
      { transport: wrongLinear.transport, env: { LINEAR_API_KEY: "linear-secret" } },
    );
    expect(linearResult).toMatchObject({ binding: null, tracker: { failure: { code: "TRACKER_TARGET_MISMATCH" } } });
    expect(wrongLinear.calls).toHaveLength(1);

    const jira = await projectWithFastFeature();
    await jira.project.configureTracker(jiraPolicy());
    const wrongJira = sequence([
      json(200, jiraIssue({
        key: "OPS-7",
        fields: { status: { id: "state-old" }, project: { key: "OPS" }, issuetype: { id: "10001" } },
      })),
    ]);
    const jiraResult = await jira.project.bindTracker(
      { mode: "attach", ticket: "OPS-7" },
      { transport: wrongJira.transport, env: { JIRA_EMAIL: "dev@example.com", JIRA_API_TOKEN: "jira-secret" } },
    );
    expect(jiraResult).toMatchObject({ binding: null, tracker: { failure: { code: "TRACKER_TARGET_MISMATCH" } } });
    expect(wrongJira.calls).toHaveLength(1);
  });

  test("provider update identity cannot replace the durable binding", async () => {
    const { project, action } = await projectWithFastFeature();
    await project.configureTracker(linearPolicy());
    const initial = sequence([
      json(200, { data: { issue: linearIssue() } }),
      json(200, { data: { issue: linearIssue() } }),
      json(200, { data: { issueUpdate: { success: true, issue: linearIssue() } } }),
    ]);
    const bound = await project.bindTracker(
      { mode: "attach", ticket: "EMP-1" },
      { transport: initial.transport, env: { LINEAR_API_KEY: "linear-secret" } },
    );
    await project.complete({ revision: action.revision, outcome: "passed", summary: "done" });
    const changed = linearIssue({ id: "other-uuid", identifier: "EMP-99", url: "https://linear.app/empirical/issue/EMP-99" });
    const fake = sequence([
      json(200, { data: { issue: linearIssue() } }),
      json(200, { data: { issueUpdate: { success: true, issue: changed } } }),
    ]);
    const result = await project.syncTracker({ transport: fake.transport, env: { LINEAR_API_KEY: "linear-secret" } });
    expect(result.tracker).toMatchObject({ health: "failed", failure: { code: "TRACKER_IDENTITY_MISMATCH" }, lastSyncedRevision: 1 });
    expect(result.binding).toMatchObject({ remoteId: bound.binding?.remoteId, remoteKey: bound.binding?.remoteKey });
  });

  test("opaque credentials from injected EmpiricalError transports are exactly redacted", async () => {
    const { root, project, action } = await projectWithFastFeature();
    await project.configureTracker(linearPolicy());
    const secret = "opaque-credential-value";
    const fake = sequence([
      new EmpiricalError("TRACKER_PROVIDER_FAILED", `provider echoed ${secret} in an opaque location`),
    ]);
    const result = await project.bindTracker(
      { mode: "attach", ticket: "EMP-1" },
      { transport: fake.transport, env: { LINEAR_API_KEY: secret } },
    );
    expect(result.tracker.failure).toMatchObject({ code: "TRACKER_PROVIDER_FAILED" });
    expect(result.tracker.failure?.summary).toContain("[REDACTED]");
    expect(result.tracker.failure?.summary).not.toContain(secret);
    expect(await readFile(
      join(root, ".empirical", "specs", action.feature!, "tracker", "pending.json"),
      "utf8",
    )).not.toContain(secret);
  });

  test("quoted or surrounded GitHub markers are not treated as machine-owned comments", async () => {
    const { project } = await projectWithFastFeature();
    await project.configureTracker(githubPolicy());
    const start = "<!-- empirical-sdd:add-a-local-tracker-fixture:start -->";
    const end = "<!-- empirical-sdd:add-a-local-tracker-fixture:end -->";
    const fake = sequence([
      json(200, { node_id: "I_kwDO_issue", number: 42, html_url: "https://github.com/goempirical/empirical-sdd/issues/42" }),
      json(200, { node_id: "I_kwDO_issue", number: 42, html_url: "https://github.com/goempirical/empirical-sdd/issues/42" }),
      json(200, { data: { node: { projectItems: { nodes: [{ id: "PVTI_item", project: { id: "PVT_project" } }], pageInfo: { hasNextPage: false, endCursor: null } } } } }),
      json(200, [
        { id: 987, body: `A user quoted this:\n> ${start}\n> stale\n> ${end}` },
        { id: 988, body: `prefix\n${start}\nstale\n${end}\nsuffix` },
      ]),
      json(201, { id: 989 }),
      json(200, { data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_item" } } } }),
    ]);
    const result = await project.bindTracker(
      { mode: "attach", ticket: "42" },
      { transport: fake.transport, env: { GITHUB_TOKEN: "github-secret" } },
    );
    expect(result.binding?.markerId).toBe("989");
    expect(fake.calls.map(({ method }) => method)).toEqual(["GET", "GET", "POST", "GET", "POST", "POST"]);
    expect(fake.calls.some(({ method }) => method === "PATCH")).toBe(false);
  });

  test("GitHub sync revalidates issue ownership and ignores forged persisted mutation ids", async () => {
    const { root, project, action } = await projectWithFastFeature();
    await project.configureTracker(githubPolicy());
    const issue = { node_id: "I_kwDO_issue", number: 42, html_url: "https://github.com/goempirical/empirical-sdd/issues/42" };
    const marker = "<!-- empirical-sdd:add-a-local-tracker-fixture:start -->\nstale\n<!-- empirical-sdd:add-a-local-tracker-fixture:end -->";
    const initial = sequence([
      json(200, issue),
      json(200, issue),
      json(200, { data: { node: { projectItems: { nodes: [{ id: "PVTI_legit", project: { id: "PVT_project" } }], pageInfo: { hasNextPage: false, endCursor: null } } } } }),
      json(200, [{ id: 987, body: marker }]),
      json(200, { id: 987 }),
      json(200, { data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_legit" } } } }),
    ]);
    expect((await project.bindTracker(
      { mode: "attach", ticket: "42" },
      { transport: initial.transport, env: { GITHUB_TOKEN: "github-secret" } },
    )).tracker.health).toBe("synced");
    const bindingPath = join(root, ".empirical", "specs", action.feature!, "tracker", "binding.json");
    const stored = JSON.parse(await readFile(bindingPath, "utf8")) as Record<string, any>;
    const { digest: _digest, ...forgedBody } = {
      ...stored,
      projectItemId: "PVTI_forged",
      markerId: "666",
    };
    await writeFile(bindingPath, `${JSON.stringify({ ...forgedBody, digest: digestJson(forgedBody) }, null, 2)}\n`, "utf8");
    await project.complete({ revision: action.revision, outcome: "passed", summary: "advance" });
    const sync = sequence([
      json(200, issue),
      json(200, { data: { node: { projectItems: { nodes: [{ id: "PVTI_legit", project: { id: "PVT_project" } }], pageInfo: { hasNextPage: false, endCursor: null } } } } }),
      json(200, [{ id: 987, body: marker }]),
      json(200, { id: 987 }),
      json(200, { data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_legit" } } } }),
    ]);
    const result = await project.syncTracker({ transport: sync.transport, env: { GITHUB_TOKEN: "github-secret" } });
    expect(result.binding).toMatchObject({ projectItemId: "PVTI_legit", markerId: "987" });
    expect(JSON.stringify(sync.calls)).not.toContain("PVTI_forged");
    expect(JSON.stringify(sync.calls)).not.toContain("/comments/666");

    const rebound = JSON.parse(await readFile(bindingPath, "utf8")) as Record<string, any>;
    const { digest: _reboundDigest, ...spoofedBody } = {
      ...rebound,
      url: "https://github.com/attacker/repository/issues/42",
    };
    await writeFile(bindingPath, `${JSON.stringify({ ...spoofedBody, digest: digestJson(spoofedBody) }, null, 2)}\n`, "utf8");
    expect((await project.statusReport()).tracker).toMatchObject({
      health: "failed",
      url: null,
      failure: { code: "TRACKER_TARGET_MISMATCH" },
    });
  });

  test("provider URL parsing accepts valid URLs longer than remote identifiers", async () => {
    const { project } = await projectWithFastFeature();
    await project.configureTracker(linearPolicy());
    const longUrl = `https://linear.app/${"workspace".repeat(40)}/issue/EMP-1`;
    expect(longUrl.length).toBeGreaterThan(256);
    const issue = linearIssue({ url: longUrl });
    const fake = sequence([
      json(200, { data: { issue } }),
      json(200, { data: { issue } }),
      json(200, { data: { issueUpdate: { success: true, issue } } }),
    ]);
    const result = await project.bindTracker(
      { mode: "attach", ticket: "EMP-1" },
      { transport: fake.transport, env: { LINEAR_API_KEY: "linear-secret" } },
    );
    expect(result.tracker.health).toBe("synced");
    expect(result.binding?.url).toBe(longUrl);
  });

  test("malformed GitHub project pagination fails before adding an item", async () => {
    const { project } = await projectWithFastFeature();
    await project.configureTracker(githubPolicy());
    const issue = { node_id: "I_kwDO_issue", number: 42, html_url: "https://github.com/goempirical/empirical-sdd/issues/42" };
    const fake = sequence([
      json(200, issue),
      json(200, issue),
      json(200, { data: { node: { projectItems: { nodes: [], pageInfo: {} } } } }),
    ]);
    const result = await project.bindTracker(
      { mode: "attach", ticket: "42" },
      { transport: fake.transport, env: { GITHUB_TOKEN: "github-secret" } },
    );
    expect(result.tracker.failure?.code).toBe("TRACKER_MALFORMED_RESPONSE");
    expect(fake.calls.filter((call) => call.body?.includes("addProjectV2ItemById"))).toHaveLength(0);
  });

  test("a malformed GitHub create response reconciles its exact marker without a second create", async () => {
    const { root, project, action } = await projectWithFastFeature();
    await project.configureTracker(githubPolicy());
    const first = sequence([{ status: 201, body: "{" }]);
    const ambiguous = await project.bindTracker(
      { mode: "create", description: "Human issue body" },
      { transport: first.transport, env: { GITHUB_TOKEN: "github-secret" } },
    );
    expect(ambiguous.tracker.failure?.code).toBe("TRACKER_CREATE_AMBIGUOUS");
    const createdBody = requestBody(first.calls[0]).body as string;
    const pending = JSON.parse(await readFile(
      join(root, ".empirical", "specs", action.feature!, "tracker", "pending.json"),
      "utf8",
    )) as Record<string, any>;
    expect(createdBody).toContain(pending.idempotencyKey);
    await project.complete({ revision: action.revision, outcome: "passed", summary: "local work completed during recovery" });

    const recovery = sequence([
      json(200, [{
        node_id: "I_kwDO_recovered",
        number: 43,
        html_url: "https://github.com/goempirical/empirical-sdd/issues/43",
        body: createdBody,
      }]),
      json(200, {
        node_id: "I_kwDO_recovered",
        number: 43,
        html_url: "https://github.com/goempirical/empirical-sdd/issues/43",
        body: createdBody,
      }),
      json(200, { data: { node: { projectItems: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } }),
      json(200, { data: { addProjectV2ItemById: { item: { id: "PVTI_recovered" } } } }),
      json(200, []),
      json(201, { id: 991 }),
      json(200, { data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_recovered" } } } }),
    ]);
    const synced = await project.syncTracker({
      transport: recovery.transport,
      env: { GITHUB_TOKEN: "github-secret" },
    });
    expect(synced.tracker).toMatchObject({ health: "synced", lastSyncedRevision: 2 });
    expect(synced.binding).toMatchObject({ remoteKey: "43", bindIdempotencyKey: pending.idempotencyKey });
    expect(recovery.calls.filter((call) => call.method === "POST" && call.url.endsWith("/issues"))).toHaveLength(0);
  });

  test("zero, duplicate, and malformed-pagination reconciliation results fail closed", async () => {
    const expectedCodes = ["TRACKER_CREATE_AMBIGUOUS", "TRACKER_CREATE_COLLISION", "TRACKER_MALFORMED_RESPONSE"];
    for (const kind of ["zero", "collision", "pagination"] as const) {
      const { project } = await projectWithFastFeature();
      await project.configureTracker(linearPolicy());
      const first = sequence([new Error("lost response")]);
      await project.bindTracker(
        { mode: "create" },
        { transport: first.transport, env: { LINEAR_API_KEY: "linear-secret" } },
      );
      const description = requestBody(first.calls[0]).variables.input.description as string;
      const nodes = kind === "collision"
        ? [
            linearIssue({ id: "one", identifier: "EMP-11", url: "https://linear.app/empirical/issue/EMP-11", description }),
            linearIssue({ id: "two", identifier: "EMP-12", url: "https://linear.app/empirical/issue/EMP-12", description }),
          ]
        : [];
      const lookup = sequence([
        json(200, { data: { issues: { nodes, pageInfo: kind === "pagination" ? {} : { hasNextPage: false, endCursor: null } } } }),
      ]);
      const result = await project.syncTracker({ transport: lookup.transport, env: { LINEAR_API_KEY: "linear-secret" } });
      expect(result.tracker.failure?.code).toBe(expectedCodes[["zero", "collision", "pagination"].indexOf(kind)]);
      expect([...first.calls, ...lookup.calls].filter((call) => call.body?.includes("issueCreate(input"))).toHaveLength(1);
    }
  });

  test("a prepared create safely dispatches once after credentials become available", async () => {
    const { root, project, action } = await projectWithFastFeature();
    await project.configureTracker(linearPolicy());
    const prepared = await project.bindTracker({ mode: "create" }, { env: {} });
    expect(prepared.tracker.failure?.code).toBe("TRACKER_CREDENTIAL_MISSING");
    const pendingPath = join(root, ".empirical", "specs", action.feature!, "tracker", "pending.json");
    expect(JSON.parse(await readFile(pendingPath, "utf8"))).toMatchObject({ intent: { mode: "create", dispatched: false } });
    const fake = sequence([
      json(200, { data: { issueCreate: { success: true, issue: linearIssue() } } }),
      json(200, { data: { issue: linearIssue() } }),
      json(200, { data: { issueUpdate: { success: true, issue: linearIssue() } } }),
    ]);
    const synced = await project.syncTracker({ transport: fake.transport, env: { LINEAR_API_KEY: "linear-secret" } });
    expect(synced.tracker.health).toBe("synced");
    expect(fake.calls.filter((call) => call.body?.includes("issueCreate(input"))).toHaveLength(1);
  });

  test("explicit replace can supersede a provably undispatched pending create on a new target", async () => {
    const { project } = await projectWithFastFeature();
    await project.configureTracker(linearPolicy());
    expect((await project.bindTracker({ mode: "create" }, { env: {} })).tracker.failure?.code).toBe("TRACKER_CREDENTIAL_MISSING");
    const targetB: LinearTrackerPolicy = {
      ...linearPolicy(),
      target: { teamId: "team-2", projectId: "project-2" },
    };
    await project.configureTracker(targetB);
    const issueB = linearIssue({
      id: "linear-b",
      identifier: "B-1",
      url: "https://linear.app/empirical/issue/B-1",
      team: { id: "team-2" },
      project: { id: "project-2" },
    });
    const fake = sequence([
      json(200, { data: { issue: issueB } }),
      json(200, { data: { issue: issueB } }),
      json(200, { data: { issueUpdate: { success: true, issue: issueB } } }),
    ]);
    const rebound = await project.bindTracker(
      { mode: "attach", ticket: "B-1", replace: true },
      { transport: fake.transport, env: { LINEAR_API_KEY: "linear-secret" } },
    );
    expect(rebound.tracker.health).toBe("synced");
    expect(rebound.binding).toMatchObject({ remoteId: "linear-b", remoteKey: "B-1" });
    expect(fake.calls).toHaveLength(3);
  });

  test("manual attach resolves an ambiguous create only with its exact marker and preserves evidence on mismatch", async () => {
    const { root, project, action } = await projectWithFastFeature();
    await project.configureTracker(linearPolicy());
    const first = sequence([new Error("lost response")]);
    await project.bindTracker(
      { mode: "create" },
      { transport: first.transport, env: { LINEAR_API_KEY: "linear-secret" } },
    );
    const pendingPath = join(root, ".empirical", "specs", action.feature!, "tracker", "pending.json");
    const before = JSON.parse(await readFile(pendingPath, "utf8")) as Record<string, any>;
    const wrong = sequence([
      json(200, { data: { issue: linearIssue({ id: "linear-5", identifier: "EMP-5", url: "https://linear.app/empirical/issue/EMP-5", description: "no marker" }) } }),
    ]);
    const mismatch = await project.bindTracker(
      { mode: "attach", ticket: "EMP-5" },
      { transport: wrong.transport, env: { LINEAR_API_KEY: "linear-secret" } },
    );
    expect(mismatch.tracker.failure?.code).toBe("TRACKER_CREATE_MARKER_MISMATCH");
    const afterMismatch = JSON.parse(await readFile(pendingPath, "utf8")) as Record<string, any>;
    expect(afterMismatch.idempotencyKey).toBe(before.idempotencyKey);
    expect(afterMismatch.intent).toEqual(before.intent);

    const description = requestBody(first.calls[0]).variables.input.description as string;
    const issue = linearIssue({ id: "linear-5", identifier: "EMP-5", url: "https://linear.app/empirical/issue/EMP-5", description });
    const recovery = sequence([
      json(200, { data: { issue } }),
      json(200, { data: { issue } }),
      json(200, { data: { issueUpdate: { success: true, issue } } }),
    ]);
    const synced = await project.bindTracker(
      { mode: "attach", ticket: "EMP-5" },
      { transport: recovery.transport, env: { LINEAR_API_KEY: "linear-secret" } },
    );
    expect(synced.tracker.health).toBe("synced");
    expect(synced.binding).toMatchObject({ remoteKey: "EMP-5", bindIdempotencyKey: before.idempotencyKey });
    expect([...first.calls, ...wrong.calls, ...recovery.calls].filter((call) => call.body?.includes("issueCreate(input"))).toHaveLength(1);
  });

  test("same-ticket replacement is associated with its new attempt and stays stable across revisions", async () => {
    const { project, action } = await projectWithFastFeature();
    await project.configureTracker(linearPolicy());
    const initial = sequence([
      json(200, { data: { issue: linearIssue() } }),
      json(200, { data: { issue: linearIssue() } }),
      json(200, { data: { issueUpdate: { success: true, issue: linearIssue() } } }),
    ]);
    const first = await project.bindTracker(
      { mode: "attach", ticket: "EMP-1" },
      { transport: initial.transport, env: { LINEAR_API_KEY: "linear-secret" } },
    );
    const replacement = sequence([
      json(200, { data: { issue: linearIssue() } }),
      { status: 503, body: "crash-window projection failure" },
    ]);
    const replaced = await project.bindTracker(
      { mode: "attach", ticket: "EMP-1", replace: true },
      { transport: replacement.transport, env: { LINEAR_API_KEY: "linear-secret" } },
    );
    expect(replaced.binding?.bindIdempotencyKey).not.toBe(first.binding?.bindIdempotencyKey);
    expect(replaced.tracker).toMatchObject({ health: "failed", failure: { code: "TRACKER_HTTP_FAILED" } });
    const recoverReplacement = sequence([
      json(200, { data: { issue: linearIssue() } }),
      json(200, { data: { issueUpdate: { success: true, issue: linearIssue() } } }),
    ]);
    expect((await project.syncTracker({
      transport: recoverReplacement.transport,
      env: { LINEAR_API_KEY: "linear-secret" },
    })).tracker.health).toBe("synced");
    let idleRequests = 0;
    expect((await project.syncTracker({
      env: { LINEAR_API_KEY: "linear-secret" },
      transport: async () => {
        idleRequests += 1;
        return json(500, {});
      },
    })).tracker.health).toBe("synced");
    expect(idleRequests).toBe(0);

    await project.complete({ revision: action.revision, outcome: "passed", summary: "done" });
    const next = sequence([
      json(200, { data: { issue: linearIssue() } }),
      json(200, { data: { issueUpdate: { success: true, issue: linearIssue() } } }),
    ]);
    expect((await project.syncTracker({ transport: next.transport, env: { LINEAR_API_KEY: "linear-secret" } })).tracker.health).toBe("synced");
    expect(next.calls).toHaveLength(2);
  });

  test("an ambiguous create is not repeated without explicit confirmation", async () => {
    const { project } = await projectWithFastFeature();
    await project.configureTracker(linearPolicy());
    const failed = sequence([
      new Error("socket closed after upload"),
      json(200, { data: { issues: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } }),
    ]);
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
