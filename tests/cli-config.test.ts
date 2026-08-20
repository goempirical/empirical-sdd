import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { digestJson } from "../src/protocol.js";

const directories: string[] = [];
const cli = resolve(import.meta.dir, "../src/cli.ts");
const trackerPolicy = {
  schemaVersion: 1,
  provider: "linear",
  target: { teamId: "linear-team", projectId: null },
  credentialEnv: { apiKey: "EMPIRICAL_TEST_UNSET_LINEAR_API_KEY" },
  states: {
    specification: "linear-state-specification",
    planned: "linear-state-planned",
    "in-progress": "linear-state-progress",
    verification: "linear-state-verification",
    review: "linear-state-review",
    blocked: "linear-state-blocked",
    done: "linear-state-done",
  },
} as const;
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "empirical-config-"));
  directories.push(value);
  return value;
}

async function run(args: string[], input = "") {
  const child = Bun.spawn([Bun.argv[0]!, "run", cli, ...args], {
    stdin: Buffer.from(input), stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

const internal = (args: string[]): string[] => ["__internal", ...args];

describe("first-run configuration CLI", () => {
  test("forced interactive init previews before writing and persists every customized answer", async () => {
    const directory = await root();
    const first = await run(internal([
      "init", "--interactive", "--no-integrations", "--root", directory,
    ]), "customize\noff\non\noff\non\nask\nmain\n../{repo}-sandbox-{feature}\n{type}/team-{feature}\nrequired\nconcise\nno-tracking\nsave\n");
    expect(first.exitCode).toBe(0);
    expect(first.stderr).toBe("");
    expect(first.stdout).toContain("Empirical setup");
    expect(first.stdout).toContain("Empirical setup · recommended");
    expect(first.stdout).toContain("Verification policy");
    expect(first.stdout).toContain("Default Git base");
    expect(first.stdout).toContain("Complex decision records");
    expect(first.stdout).toContain("Track work by type (recommended default)");
    expect(first.stdout).toContain("No tracking");
    expect(first.stdout).toContain("Save these effective settings");
    expect(JSON.parse(await readFile(join(directory, ".empirical/config.json"), "utf8"))).toMatchObject({
      setupComplete: true,
      evidence: { required: false, browserForUi: true, screenshotForUi: false, codeReview: true },
      isolation: {
        mode: "ask",
        baseBranch: "main",
        worktreePath: "../{repo}-sandbox-{feature}",
        branchPattern: "{type}/team-{feature}",
      },
      decisions: { complexRecords: "required" },
      interaction: { questions: "concise" },
    });
    expect(JSON.parse(await readFile(join(directory, ".empirical/tracker.json"), "utf8")))
      .toEqual({ schemaVersion: 1, mode: "disabled" });

    const second = await run(internal(["init", "--interactive", "--no-integrations", "--root", directory]), "\n");
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toContain("Empirical setup · current");
    expect(second.stdout).toContain("Keep current settings");
    expect(JSON.parse(await readFile(join(directory, ".empirical/config.json"), "utf8"))).toMatchObject({
      evidence: { required: false, browserForUi: true, screenshotForUi: false, codeReview: true },
      isolation: { mode: "ask", baseBranch: "main" },
    });
  });

  test("applying recommended settings still requires and persists a tracker choice", async () => {
    const directory = await root();
    const initialized = await run(internal([
      "init", "--interactive", "--no-integrations", "--root", directory,
    ]), "\nno-tracking\n\n");
    expect(initialized.exitCode).toBe(0);
    expect(initialized.stdout).toContain("Track work by type (recommended default)");
    expect(initialized.stdout).toContain("Save this complete setup?");
    expect(JSON.parse(await readFile(join(directory, ".empirical/tracker.json"), "utf8")))
      .toEqual({ schemaVersion: 1, mode: "disabled" });
  });

  test("setup cancellation happens before first-run or repair mutation", async () => {
    const directory = await root();
    const cancelled = await run(internal([
      "init", "--interactive", "--no-integrations", "--root", directory,
    ]), "cancel\n");
    expect(cancelled.exitCode).toBe(1);
    expect(cancelled.stderr).toContain("SETUP_CANCELLED");
    expect(await stat(join(directory, ".empirical")).then(() => true, () => false)).toBe(false);

    await run(internal(["init", "--defaults", "--no-integrations", "--root", directory]));
    const configPath = join(directory, ".empirical", "config.json");
    const before = await readFile(configPath, "utf8");
    const repairCancelled = await run(internal([
      "init", "--interactive", "--no-integrations", "--root", directory,
    ]), "cancel\n");
    expect(repairCancelled.exitCode).toBe(1);
    expect(await readFile(configPath, "utf8")).toBe(before);
  });

  test("non-interactive init uses safe defaults and explicit flags can replace them", async () => {
    const directory = await root();
    const initialized = await run(internal(["init", "--defaults", "--no-integrations", "--json", "--root", directory]));
    expect(initialized.exitCode).toBe(0);
    expect(JSON.parse(initialized.stdout).config).toMatchObject({
      setupComplete: true,
      evidence: { required: true, browserForUi: true, screenshotForUi: true, codeReview: true },
      isolation: { mode: "ask", baseBranch: "auto", worktreePath: "../{repo}-{feature}", branchPattern: "{type}/{feature}" },
      decisions: { complexRecords: "required" },
      interaction: { questions: "concise" },
    });
    const configured = await run(internal([
      "config", "--isolation", "off", "--base", "develop",
      "--worktree-path", "../alt-{feature}", "--branch-pattern", "{type}/alt-{feature}",
      "--decisions", "off", "--evidence", "off", "--ui-browser", "off",
      "--ui-screenshot", "on", "--code-review", "on", "--questions", "detailed",
      "--json", "--root", directory,
    ]));
    expect(configured.exitCode).toBe(0);
    expect(JSON.parse(configured.stdout)).toMatchObject({
      isolation: { mode: "off", baseBranch: "develop", worktreePath: "../alt-{feature}", branchPattern: "{type}/alt-{feature}" },
      decisions: { complexRecords: "off" },
      evidence: { required: false, browserForUi: false, screenshotForUi: true, codeReview: true },
      interaction: { questions: "detailed" },
    });

    const partial = await run(internal([
      "config", "--evidence", "on", "--json", "--root", directory,
    ]));
    expect(JSON.parse(partial.stdout)).toMatchObject({
      evidence: { required: true, browserForUi: false, screenshotForUi: true, codeReview: true },
      isolation: { mode: "off", baseBranch: "develop" },
      decisions: { complexRecords: "off" },
      interaction: { questions: "detailed" },
    });
  });

  test("non-interactive init accepts the strict tracker setup contract", async () => {
    const directory = await root();
    const trackerInput = join(directory, "tracker-setup.json");
    await writeFile(trackerInput, JSON.stringify({ mode: "disabled" }), "utf8");
    const initialized = await run(internal([
      "init", "--defaults", "--tracker-input", trackerInput, "--no-integrations", "--json", "--root", directory,
    ]));
    expect(initialized.exitCode).toBe(0);
    expect(JSON.parse(initialized.stdout).config.setupComplete).toBe(true);
    expect(JSON.parse(await readFile(join(directory, ".empirical", "tracker.json"), "utf8")))
      .toEqual({ schemaVersion: 1, mode: "disabled" });

    const invalidRoot = await root();
    const invalidTrackerInput = join(invalidRoot, "tracker-setup.json");
    await writeFile(invalidTrackerInput, JSON.stringify({ mode: "disabled", unexpected: true }), "utf8");
    const invalid = await run(internal([
      "init", "--defaults", "--tracker-input", invalidTrackerInput, "--no-integrations", "--root", invalidRoot,
    ]));
    expect(invalid.exitCode).toBe(1);
    expect(invalid.stderr).toContain("INVALID_TRACKER_SETUP");
    expect(await stat(join(invalidRoot, ".empirical")).then(() => true, () => false)).toBe(false);
  });

  test("legacy workstream flags and commands are rejected", async () => {
    const directory = await root();
    await run(internal(["init", "--defaults", "--no-integrations", "--root", directory]));
    await run(internal(["config", "--questions", "detailed", "--root", directory]));
    const flag = await run(internal(["status", "--workstream", "legacy", "--root", directory]));
    expect(flag.exitCode).toBe(1);
    expect(flag.stderr).toContain("INVALID_ARGUMENT");
    const command = await run(["workstream", "list", "--root", directory]);
    expect(command.exitCode).toBe(1);
    expect(command.stderr).toContain("UNKNOWN_COMMAND");
  });

  test("tracker-bind validates strict mode-specific JSON before opening a project", async () => {
    const directory = await root();
    for (const input of [
      { mode: "invalid" },
      { mode: "attach" },
      { mode: "attach", ticket: "LIN-1", title: "Not applicable" },
      { mode: "attach", ticket: "LIN-1", description: "Not applicable" },
      { mode: "attach", ticket: "LIN-1", confirmCreateRetry: true },
      { mode: "create", ticket: "LIN-1" },
      { mode: "create", unknown: true },
    ]) {
      const result = await run(internal([
        "tracker-bind", "--input", "-", "--root", directory,
      ]), JSON.stringify(input));
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("INVALID_TRACKER_BIND_INPUT");
      expect(result.stderr).not.toContain("PROJECT_NOT_INITIALIZED");
    }
    expect(await stat(join(directory, ".empirical")).then(() => true, () => false)).toBe(false);
  });

  test("tracker status, action, bind, and sync human output expose bounded recovery state", async () => {
    const directory = await root();
    await run(internal(["init", "--defaults", "--no-integrations", "--root", directory]));
    await run(internal(["config", "--questions", "detailed", "--root", directory]));
    await run(internal(["fast", "Make tracker recovery observable", "--root", directory]));
    const configured = await run(internal([
      "tracker-configure", "--input", "-", "--root", directory,
    ]), JSON.stringify(trackerPolicy));
    expect(configured.exitCode).toBe(0);

    const bound = await run(internal([
      "tracker-bind", "--input", "-", "--root", directory,
    ]), JSON.stringify({ mode: "create" }));
    const action = await run(internal(["next", "--root", directory]));
    const status = await run(internal(["status", "--root", directory]));
    const synced = await run(internal(["tracker-sync", "--root", directory]));

    for (const result of [bound, action, status, synced]) {
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("External tracker:");
      expect(result.stdout).toContain("- Health: failed");
      expect(result.stdout).toContain("- Provider: linear");
      expect(result.stdout).toContain("- URL: none");
      expect(result.stdout).toContain("- Committed revision: 1");
      expect(result.stdout).toContain("- Last-synced revision: none");
      expect(result.stdout).toContain("- Pending revision: 1");
      expect(result.stdout).toContain("- Failure: TRACKER_CREDENTIAL_MISSING —");
      expect(result.stdout).toContain("- Failure at:");
      expect(result.stdout).toContain("- Recovery: Inject the configured credential environment variable");
      const failureLine = result.stdout.split("\n").find((line) => line.startsWith("- Failure:"));
      expect(failureLine?.length).toBeLessThanOrEqual(580);
    }
  });

  test("tracker status and action human output expose a validated bound URL", async () => {
    const directory = await root();
    await run(internal(["init", "--defaults", "--no-integrations", "--root", directory]));
    await run(internal(["config", "--questions", "detailed", "--root", directory]));
    const started = await run(internal([
      "fast", "Show a safe tracker URL", "--json", "--root", directory,
    ]));
    expect(started.exitCode).toBe(0);
    const feature = (JSON.parse(started.stdout) as { feature: string }).feature;
    await run(internal([
      "tracker-configure", "--input", "-", "--root", directory,
    ]), JSON.stringify(trackerPolicy));

    const bindingBody = {
      schemaVersion: 1,
      feature,
      provider: "linear",
      remoteId: "linear-uuid",
      remoteKey: "LIN-1",
      url: "https://linear.app/empirical/issue/LIN-1",
      projectItemId: null,
      markerId: null,
      targetDigest: digestJson({ provider: trackerPolicy.provider, target: trackerPolicy.target }),
      bindIdempotencyKey: digestJson({ feature, provider: "linear", remoteId: "linear-uuid" }),
      lastSyncedRevision: null,
      lastSyncedDigest: null,
      lastSyncedPolicyDigest: null,
    } as const;
    const trackerDirectory = join(directory, ".empirical", "specs", feature, "tracker");
    await mkdir(trackerDirectory, { recursive: true });
    await writeFile(join(trackerDirectory, "binding.json"), `${JSON.stringify({
      ...bindingBody,
      digest: digestJson(bindingBody),
    }, null, 2)}\n`, "utf8");

    for (const result of [
      await run(internal(["status", "--root", directory])),
      await run(internal(["next", "--root", directory])),
    ]) {
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("- Health: pending");
      expect(result.stdout).toContain("- Provider: linear");
      expect(result.stdout).toContain("- URL: https://linear.app/empirical/issue/LIN-1");
      expect(result.stdout).toContain("- Committed revision: 1");
      expect(result.stdout).toContain("- Last-synced revision: none");
      expect(result.stdout).toContain("- Pending revision: 1");
      expect(result.stdout).toContain("- Failure: none");
    }
  });

  test("concise mode renders compact action and status without hiding completion", async () => {
    const directory = await root();
    await run(internal(["init", "--defaults", "--no-integrations", "--root", directory]));
    const started = await run(internal([
      "fast", "Add one compact status fixture", "--root", directory,
    ]));
    expect(started.exitCode).toBe(0);
    expect(started.stdout).toContain("Empirical · step 1/2");
    expect(started.stdout).toContain("Tracker: local-only");
    expect(started.stdout).toContain("Complete: empirical __internal complete");
    expect(started.stdout).not.toContain("External tracker:");
    expect(started.stdout).not.toContain("Acceptance criteria:");

    const status = await run(internal(["status", "--root", directory]));
    expect(status.stdout).toContain("feature=add-one-compact-status-fixture");
    expect(status.stdout).toContain("Tracker: local-only");
    expect(status.stdout).not.toContain("External tracker:");
  });

  test("interactive/default modes reject conflicting configuration flags before mutation", async () => {
    const directory = await root();
    const interactive = await run(internal([
      "init", "--interactive", "--evidence", "off", "--no-integrations", "--root", directory,
    ]));
    expect(interactive.exitCode).toBe(1);
    expect(interactive.stderr).toContain("INVALID_ARGUMENT");
    expect(await stat(join(directory, ".empirical")).then(() => true, () => false)).toBe(false);

    const defaults = await run(internal([
      "init", "--defaults", "--decisions", "off", "--no-integrations", "--root", directory,
    ]));
    expect(defaults.exitCode).toBe(1);
    expect(defaults.stderr).toContain("INVALID_ARGUMENT");
    expect(await stat(join(directory, ".empirical")).then(() => true, () => false)).toBe(false);

    const invalidQuestions = await run(internal([
      "init", "--questions", "brief", "--no-integrations", "--root", directory,
    ]));
    expect(invalidQuestions.exitCode).toBe(1);
    expect(invalidQuestions.stderr).toContain("--questions must be concise or detailed");
    expect(await stat(join(directory, ".empirical")).then(() => true, () => false)).toBe(false);
  });

  test("Explain has matching human and JSON surfaces", async () => {
    const directory = await root();
    await run(internal(["init", "--defaults", "--no-integrations", "--root", directory]));
    await run(internal(["fast", "Add one explainable command", "--root", directory]));
    const human = await run(internal(["explain", "--root", directory]));
    const json = await run(internal(["explain", "--json", "--root", directory]));
    expect(human.exitCode).toBe(0);
    expect(human.stdout).toContain("Empirical Explain");
    expect(human.stdout).toContain("Gate: proceed");
    expect(JSON.parse(json.stdout)).toMatchObject({
      feature: "add-one-explainable-command",
      rationale: { gate: "proceed" },
    });
  });
});
