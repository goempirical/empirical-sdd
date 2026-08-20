import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EmpiricalProject } from "./core.js";
import { recommendedTrackerTicketRules } from "./tracking.js";
import type {
  LinearTrackerPolicyV2,
  TrackerHttpRequest,
  TrackerHttpResponse,
  TrackerTransport,
} from "./types.js";

function git(root: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", shell: false });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

function json(value: unknown): TrackerHttpResponse {
  return { status: 200, body: JSON.stringify(value) };
}

function discovery(): TrackerHttpResponse {
  return json({
    data: {
      organization: { id: "demo-workspace", name: "Demo Workspace", urlKey: "demo" },
      teams: {
        nodes: [{
          id: "demo-team",
          name: "Demo Team",
          key: "DEMO",
          projects: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
          states: {
            nodes: [
              { id: "todo", name: "Todo", type: "unstarted", position: 0 },
              { id: "doing", name: "In Progress", type: "started", position: 1 },
              { id: "review", name: "Review", type: "started", position: 2 },
              { id: "done", name: "Done", type: "completed", position: 3 },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        }],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    },
  });
}

const issue = {
  id: "demo-issue-id",
  identifier: "DEMO-1",
  url: "https://linear.app/demo/issue/DEMO-1",
  description: "",
  team: { id: "demo-team" },
  project: null,
};

const responses: TrackerHttpResponse[] = [
  discovery(),
  json({ data: { issues: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } }),
  json({ data: { issueCreate: { success: true, issue } } }),
  json({ data: { issue } }),
  json({ data: { issueUpdate: { success: true, issue } } }),
  json({ data: { issue: { comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } }),
  json({ data: { commentCreate: { success: true, comment: { id: "demo-comment", body: "created" } } } }),
];
const providerCalls: TrackerHttpRequest[] = [];
const transport: TrackerTransport = async (request) => {
  providerCalls.push(request);
  const response = responses.shift();
  if (!response) throw new Error(`Unexpected mock provider request: ${request.method} ${request.url}`);
  return response;
};

const policy: LinearTrackerPolicyV2 = {
  schemaVersion: 2,
  provider: "linear",
  target: { teamId: "demo-team", projectId: null },
  credentialEnv: { apiKey: "LINEAR_SECRET_KEY" },
  states: {
    specification: "todo",
    planned: "todo",
    "in-progress": "doing",
    verification: "review",
    review: "review",
    blocked: "doing",
    done: "done",
  },
  ticket: "ensure",
  visibility: "milestones",
  ticketRules: recommendedTrackerTicketRules(),
};

const temporary = await mkdtemp(join(tmpdir(), "empirical-ticket-policy-demo-"));
const root = join(temporary, "repository");
let oauthCalls = 0;
let liveNetworkCount = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  liveNetworkCount += 1;
  throw new Error("The ticket-policy demo attempted an unexpected live network request");
}) as typeof globalThis.fetch;

try {
  await mkdir(root);
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.email", "demo@empirical.test"]);
  git(root, ["config", "user.name", "Empirical Demo"]);
  await writeFile(join(root, "README.md"), "# Ticket policy demo\n", "utf8");

  const initialized = await EmpiricalProject.initialize(root, {
    integrations: false,
    interaction: { questions: "concise" },
    evidence: {
      required: false,
      browserForUi: false,
      screenshotForUi: false,
      codeReview: false,
    },
    setupComplete: true,
  });
  const dependencies = {
    transport,
    env: {},
    oauthResolver: {
      resolve: async () => {
        oauthCalls += 1;
        return { provider: "linear" as const, accessToken: "in-memory-demo-authorization" };
      },
    },
  };
  await initialized.project.configureTracker(policy, dependencies);
  const action = await initialized.project.complex(
    "Add a new loadout feature with no assigned ticket",
  );
  if (action.kind !== "action") throw new Error("Demo unexpectedly proposed a worktree");

  const synchronized = await initialized.project.syncTracker(dependencies);
  const feature = action.feature;
  if (!feature || !synchronized.binding) throw new Error("Demo did not create a durable ticket binding");
  const persisted = JSON.parse(await readFile(
    join(root, ".empirical", "specs", feature, "tracker", "binding.json"),
    "utf8",
  )) as { remoteKey?: string };
  const createCount = providerCalls.filter((request) =>
    typeof request.body === "string" && request.body.includes("issueCreate(input"),
  ).length;
  const bindingCount = persisted.remoteKey === synchronized.binding.remoteKey ? 1 : 0;
  if (responses.length !== 0 || createCount !== 1 || bindingCount !== 1) {
    throw new Error("Demo did not converge to exactly one create and one binding");
  }

  process.stdout.write(`${JSON.stringify({
    scenario: "new Complex feature with no assigned ticket",
    interactionMode: action.interaction.questions,
    changeType: synchronized.tracker.changeType,
    ticketRequirement: synchronized.tracker.ticketRequirement,
    createCount,
    bindingCount,
    bindingKey: synchronized.binding.remoteKey,
    providerCallCount: providerCalls.length,
    oauthCallCount: oauthCalls,
    liveNetworkCount,
  }, null, 2)}\n`);
} finally {
  globalThis.fetch = originalFetch;
  await rm(temporary, { recursive: true, force: true });
}
