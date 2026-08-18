import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { doctorRepository } from "../src/doctor.js";
import { appendJournalEvent } from "../src/journal.js";
import { migrateSchema4To5 } from "../src/migration.js";
import { digestJson, sha256, type JsonValue } from "../src/protocol.js";
import { EmpiricalProject } from "../src/core.js";
import { refreshRepositoryKnowledge } from "../src/knowledge.js";

const parents: string[] = [];
afterEach(async () => {
  await Promise.all(parents.splice(0).map((parent) => rm(parent, { recursive: true, force: true })));
});

function git(root: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", shell: false });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

async function fixture(): Promise<{ parent: string; root: string }> {
  const parent = await mkdtemp(join(tmpdir(), "empirical-doctor-"));
  parents.push(parent);
  const root = join(parent, "repository");
  await mkdir(root);
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Empirical Test"]);
  await writeFile(join(root, "README.md"), "doctor fixture\n", "utf8");
  await writeFile(join(root, "package.json"), '{"scripts":{"test":"bun test"}}\n', "utf8");
  await EmpiricalProject.initialize(root, { setupComplete: true });
  await Promise.all(["overview", "architecture", "commands", "conventions"].map((page) =>
    writeFile(
      join(root, ".empirical", "context", `${page}.md`),
      `# ${page}\n\nVerified fixture context.\n`,
      "utf8",
    )
  ));
  await refreshRepositoryKnowledge(root);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "schema 5 fixture"]);
  return { parent, root };
}

async function fileSnapshot(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.shift()!;
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === ".git") continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) result[relative(root, path)] = sha256(await readFile(path));
    }
  }
  return result;
}

function gitSnapshot(root: string): Record<string, string> {
  return {
    head: git(root, ["rev-parse", "HEAD"]),
    status: git(root, ["status", "--porcelain=v2", "--untracked-files=all"]),
    worktrees: git(root, ["worktree", "list", "--porcelain"]),
  };
}

describe("read-only Doctor diagnostics", () => {
  test("reports incomplete initialization and a pending migration without mutating either", async () => {
    const parent = await mkdtemp(join(tmpdir(), "empirical-doctor-empty-"));
    parents.push(parent);
    const root = join(parent, "repository");
    await mkdir(join(root, ".empirical"), { recursive: true });
    await writeFile(join(root, ".empirical.schema5-migration.json"), "{}\n", "utf8");
    const before = await fileSnapshot(root);
    const report = await doctorRepository(root);
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "SCHEMA_CONFIG_MISSING", severity: "error" }),
      expect.objectContaining({ code: "MIGRATION_TRANSACTION_PENDING", severity: "warning" }),
      expect.objectContaining({ code: "POLICY_MISSING", severity: "error" }),
      expect.objectContaining({ code: "KNOWLEDGE_PAGES_MISSING", severity: "warning" }),
      expect.objectContaining({ code: "JOURNAL_LEGACY", severity: "warning" }),
      expect.objectContaining({ code: "CAPABILITY_CLAIMS_INVALID", severity: "error" }),
      expect.objectContaining({ code: "WORKTREE_INSPECTION_FAILED", severity: "warning" }),
    ]));
    expect(await fileSnapshot(root)).toEqual(before);
  });

  test("reports a healthy Schema-5 repository without changing files or Git state", async () => {
    const { root } = await fixture();
    const beforeFiles = await fileSnapshot(root);
    const beforeGit = gitSnapshot(root);
    const report = await doctorRepository(root);
    expect(report.readonly).toBe(true);
    expect(report.status).toBe("healthy");
    expect(report.findings).toContainEqual(
      expect.objectContaining({ code: "SCHEMA_CURRENT", severity: "ok" }),
    );
    expect(report.findings).toContainEqual(
      expect.objectContaining({ code: "POLICY_VALID", severity: "ok" }),
    );
    expect(report.findings).toContainEqual(
      expect.objectContaining({ code: "TRACKER_LOCAL_ONLY", severity: "ok" }),
    );
    expect(report.findings).toContainEqual(
      expect.objectContaining({ code: "PROJECT_INTEGRATIONS_READY", severity: "ok" }),
    );
    expect(await fileSnapshot(root)).toEqual(beforeFiles);
    expect(gitSnapshot(root)).toEqual(beforeGit);
  });

  test("detects completed repositories with missing integrations and verifies explicit repair", async () => {
    const { root } = await fixture();
    const missing = [
      "AGENTS.md",
      ".agents/skills/empirical/SKILL.md",
      ".mcp.json",
    ];
    await Promise.all(missing.map((path) => rm(join(root, ...path.split("/")))));
    const project = await EmpiricalProject.open(root);
    const beforeConfig = await project.config();
    const beforeState = await project.status();
    const beforeFiles = await fileSnapshot(root);
    const beforeGit = gitSnapshot(root);

    const report = await doctorRepository(root);

    expect(report.readonly).toBe(true);
    expect(report.status).toBe("errors");
    expect(report.findings).toContainEqual(expect.objectContaining({
      code: "PROJECT_INTEGRATIONS_MISSING",
      severity: "error",
      message: expect.stringContaining(".agents/skills/empirical/SKILL.md"),
      remediation: expect.stringContaining("empirical-init"),
    }));
    expect(await fileSnapshot(root)).toEqual(beforeFiles);
    expect(gitSnapshot(root)).toEqual(beforeGit);

    const repaired = await EmpiricalProject.initialize(root);
    expect(repaired.integrations.created.sort()).toEqual(missing.sort());
    expect(await repaired.project.config()).toEqual(beforeConfig);
    expect(await repaired.project.status()).toEqual(beforeState);
    const verified = await doctorRepository(root);
    expect(verified.findings).toContainEqual(expect.objectContaining({
      code: "PROJECT_INTEGRATIONS_READY",
      severity: "ok",
    }));
    expect(verified.findings.some((entry) => entry.code === "PROJECT_INTEGRATIONS_MISSING")).toBe(false);
    expect(verified.findings.some((entry) => entry.code === "PROJECT_INTEGRATIONS_DRIFTED")).toBe(false);
  });

  test("defers integration readiness until setup is complete and rejects an invalid completion marker", async () => {
    const { root } = await fixture();
    const project = await EmpiricalProject.open(root);
    await project.configure({ setupComplete: false });
    await rm(join(root, "AGENTS.md"));

    const incomplete = await doctorRepository(root);
    expect(incomplete.findings).toContainEqual(expect.objectContaining({
      code: "PROJECT_SETUP_INCOMPLETE",
      severity: "warning",
    }));
    expect(incomplete.findings.some((entry) => entry.code === "PROJECT_INTEGRATIONS_MISSING")).toBe(false);

    const configPath = join(root, ".empirical", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
    delete config.setupComplete;
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    const invalid = await doctorRepository(root);
    expect(invalid.findings).toContainEqual(expect.objectContaining({
      code: "PROJECT_SETUP_STATE_INVALID",
      severity: "error",
    }));
    expect(invalid.findings.some((entry) => entry.code === "PROJECT_INTEGRATIONS_MISSING")).toBe(false);
  });

  test("repairs owned integration drift but preserves and continues reporting unmanaged collisions", async () => {
    const { root } = await fixture();
    const skillPath = join(root, ".agents", "skills", "empirical", "SKILL.md");
    const skill = await readFile(skillPath, "utf8");
    await writeFile(skillPath, skill.replace("# Empirical\n", "# Stale Empirical\n"), "utf8");

    const drifted = await doctorRepository(root);
    expect(drifted.findings).toContainEqual(expect.objectContaining({
      code: "PROJECT_INTEGRATIONS_DRIFTED",
      severity: "error",
      message: expect.stringContaining(".agents/skills/empirical/SKILL.md"),
    }));
    const ownedRepair = await EmpiricalProject.initialize(root);
    expect(ownedRepair.integrations.updated).toContain(".agents/skills/empirical/SKILL.md");
    expect((await doctorRepository(root)).findings).toContainEqual(expect.objectContaining({
      code: "PROJECT_INTEGRATIONS_READY",
      severity: "ok",
    }));

    const collisionPath = join(root, ".mcp.json");
    const collision = '{"mcpServers":{"empirical":{"command":"custom-agent","args":[]}}}\n';
    await writeFile(collisionPath, collision, "utf8");
    const collisionBefore = await fileSnapshot(root);
    const collisionReport = await doctorRepository(root);
    expect(collisionReport.findings).toContainEqual(expect.objectContaining({
      code: "PROJECT_INTEGRATIONS_DRIFTED",
      severity: "error",
      message: expect.stringContaining(".mcp.json"),
    }));
    expect(await fileSnapshot(root)).toEqual(collisionBefore);

    const preserved = await EmpiricalProject.initialize(root);
    expect(preserved.integrations.preserved).toContain(".mcp.json (existing empirical MCP entry)");
    expect(await readFile(collisionPath, "utf8")).toBe(collision);
    expect((await doctorRepository(root)).findings).toContainEqual(expect.objectContaining({
      code: "PROJECT_INTEGRATIONS_DRIFTED",
      severity: "error",
    }));
  });

  test("validates dormant tracker records without policy and leaves their hashes unchanged", async () => {
    const { root } = await fixture();
    for (const [feature, name] of [
      ["dormant-binding", "binding.json"],
      ["dormant-pending", "pending.json"],
    ] as const) {
      const trackerDirectory = join(root, ".empirical", "specs", feature, "tracker");
      await mkdir(trackerDirectory, { recursive: true });
      await writeFile(join(trackerDirectory, name), '{"schemaVersion":1}\n', "utf8");
    }
    const unsafeFeature = "dormant-unsafe-binding";
    const unsafeBinding = {
      schemaVersion: 1,
      feature: unsafeFeature,
      provider: "linear",
      remoteId: "linear-uuid",
      remoteKey: "EMP-1",
      url: "https://user:secret@linear.app/example/issue/EMP-1?token=value#fragment",
      projectItemId: null,
      markerId: null,
      targetDigest: digestJson({ provider: "linear", target: { teamId: "team-1", projectId: null } }),
      lastSyncedRevision: null,
      lastSyncedDigest: null,
      lastSyncedPolicyDigest: null,
    } as const;
    const unsafeTrackerDirectory = join(root, ".empirical", "specs", unsafeFeature, "tracker");
    await mkdir(unsafeTrackerDirectory, { recursive: true });
    await writeFile(
      join(unsafeTrackerDirectory, "binding.json"),
      `${JSON.stringify({ ...unsafeBinding, digest: digestJson(unsafeBinding) }, null, 2)}\n`,
      "utf8",
    );
    const beforeFiles = await fileSnapshot(root);
    const beforeGit = gitSnapshot(root);

    const report = await doctorRepository(root);

    expect(report.readonly).toBe(true);
    expect(report.status).toBe("errors");
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "TRACKER_LOCAL_ONLY", severity: "ok" }),
      expect.objectContaining({
        code: "TRACKER_STATE_INVALID",
        severity: "error",
        scope: "tracker:dormant-binding",
      }),
      expect.objectContaining({
        code: "TRACKER_STATE_INVALID",
        severity: "error",
        scope: "tracker:dormant-pending",
      }),
      expect.objectContaining({
        code: "TRACKER_STATE_INVALID",
        severity: "error",
        scope: "tracker:dormant-unsafe-binding",
      }),
    ]));
    expect(await fileSnapshot(root)).toEqual(beforeFiles);
    expect(gitSnapshot(root)).toEqual(beforeGit);
  });

  test("validates tracker policy and reports only missing credential variable names", async () => {
    const { root } = await fixture();
    const variable = "EMPIRICAL_TEST_LINEAR_API_KEY_MISSING";
    delete process.env[variable];
    const project = await EmpiricalProject.open(root);
    await project.configureTracker({
      schemaVersion: 1,
      provider: "linear",
      target: { teamId: "team-1", projectId: null },
      credentialEnv: { apiKey: variable },
      states: {
        specification: "state-spec",
        planned: "state-plan",
        "in-progress": "state-work",
        verification: "state-verify",
        review: "state-review",
        blocked: "state-blocked",
        done: "state-done",
      },
    });
    const report = await doctorRepository(root);
    expect(report.findings).toContainEqual(expect.objectContaining({
      code: "TRACKER_CREDENTIALS_MISSING",
      severity: "warning",
      message: expect.stringContaining(variable),
    }));
    expect(JSON.stringify(report)).not.toContain("apiKey\":");

    const action = await project.fast("Validate malformed tracker state");
    if (action.kind !== "action" || !action.feature) throw new Error("Expected a feature action");
    const trackerDirectory = join(root, ".empirical", "specs", action.feature, "tracker");
    await mkdir(trackerDirectory, { recursive: true });
    await writeFile(join(trackerDirectory, "binding.json"), '{"schemaVersion":1}\n', "utf8");
    const malformed = await doctorRepository(root);
    expect(malformed.findings).toContainEqual(expect.objectContaining({
      code: "TRACKER_STATE_INVALID",
      severity: "error",
    }));
  });

  test("reports placeholder context as refinement-required without mutating it", async () => {
    const parent = await mkdtemp(join(tmpdir(), "empirical-doctor-refinement-"));
    parents.push(parent);
    const root = join(parent, "repository");
    await mkdir(root);
    git(root, ["init", "-b", "main"]);
    git(root, ["config", "user.email", "test@example.com"]);
    git(root, ["config", "user.name", "Empirical Test"]);
    await writeFile(join(root, "index.html"), "<!doctype html><title>Fixture</title>\n", "utf8");
    await EmpiricalProject.initialize(root, { setupComplete: true });
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "placeholder context fixture"]);
    const before = await fileSnapshot(root);
    const report = await doctorRepository(root);
    expect(report.status).toBe("warnings");
    expect(report.findings).toContainEqual(expect.objectContaining({
      code: "KNOWLEDGE_REFINEMENT_REQUIRED",
      severity: "warning",
    }));
    expect(await fileSnapshot(root)).toEqual(before);
  });

  test("remains read-only when command execution provides no home or XDG directories", async () => {
    const { root } = await fixture();
    const beforeFiles = await fileSnapshot(root);
    const source = new URL("../src/doctor.ts", import.meta.url).href;
    const child = spawnSync(
      process.execPath,
      [
        "-e",
        `import { doctorRepository } from ${JSON.stringify(source)}; await doctorRepository(${JSON.stringify(root)});`,
      ],
      {
        cwd: root,
        encoding: "utf8",
        shell: false,
        env: {
          PATH: process.env.PATH ?? "",
          TMPDIR: tmpdir(),
          NO_COLOR: "1",
        },
      },
    );
    expect(child.status).toBe(0);
    expect(await fileSnapshot(root)).toEqual(beforeFiles);
  });

  test("validates Schema-5 policy, knowledge, journals, tools, claims, evidence, and worktrees without mutation", async () => {
    const { root } = await fixture();
    await migrateSchema4To5(root, {
      now: () => new Date("2026-08-03T12:00:00Z"),
    });
    const beforeFiles = await fileSnapshot(root);
    const beforeGit = gitSnapshot(root);
    const report = await doctorRepository(root);
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "SCHEMA_CURRENT", severity: "ok" }),
        expect.objectContaining({ code: "POLICY_VALID", severity: "ok" }),
        expect.objectContaining({ code: "KNOWLEDGE_CURRENT", severity: "ok" }),
        expect.objectContaining({ code: "JOURNAL_CHAINS_VALID", severity: "ok" }),
        expect.objectContaining({ code: "CAPABILITY_CLAIMS_VALID", severity: "ok" }),
        expect.objectContaining({ code: "EVIDENCE_RECEIPTS_INSPECTED", severity: "ok" }),
      ]),
    );
    expect(report.findings.some((entry) => entry.severity === "error")).toBe(false);
    expect(await fileSnapshot(root)).toEqual(beforeFiles);
    expect(gitSnapshot(root)).toEqual(beforeGit);
  });

  test("finds a tampered journal chain and leaves it untouched", async () => {
    const { root } = await fixture();
    await migrateSchema4To5(root);
    const feature = "tampered-feature";
    const featureDirectory = join(root, ".empirical", "specs", feature);
    const eventsDirectory = join(featureDirectory, "events");
    await mkdir(eventsDirectory, { recursive: true });
    const state: Record<string, JsonValue> = {
      schemaVersion: 5,
      revision: 1,
      activeFeature: feature,
      phase: "implement",
      status: "waiting",
    };
    await writeFile(
      join(featureDirectory, "state.json"),
      `${JSON.stringify(state, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      join(featureDirectory, "impact.json"),
      `${JSON.stringify({ schemaVersion: 1, digest: digestJson({ feature }) }, null, 2)}\n`,
      "utf8",
    );
    await appendJournalEvent({
      directory: eventsDirectory,
      feature,
      actor: "tester",
      summary: "Started",
      state,
      now: () => new Date("2026-08-03T12:00:00Z"),
    });
    const eventPath = join(eventsDirectory, "00000001.json");
    const event = JSON.parse(await readFile(eventPath, "utf8")) as Record<string, unknown>;
    await writeFile(
      eventPath,
      `${JSON.stringify({ ...event, summary: "tampered" }, null, 2)}\n`,
      "utf8",
    );
    const before = await readFile(eventPath, "utf8");
    const report = await doctorRepository(root);
    expect(report.status).toBe("errors");
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        code: "JOURNAL_CHAIN_INVALID",
        scope: `journal:${feature}`,
      }),
    );
    expect(await readFile(eventPath, "utf8")).toBe(before);
  });

  test("reports a prunable registration but never prunes or removes it", async () => {
    const { parent, root } = await fixture();
    await migrateSchema4To5(root);
    const stale = join(parent, "stale-worktree");
    git(root, ["worktree", "add", "-b", "stale", stale, "HEAD"]);
    await rm(stale, { recursive: true, force: true });
    const before = git(root, ["worktree", "list", "--porcelain"]);
    const report = await doctorRepository(root);
    expect(report.findings).toContainEqual(
      expect.objectContaining({ code: "WORKTREE_REGISTRATION_PRUNABLE" }),
    );
    expect(git(root, ["worktree", "list", "--porcelain"])).toBe(before);
    expect(before).toContain("branch refs/heads/stale");
    expect(before).toContain("prunable ");
  });

  test("reports orphan migration scratch without changing it", async () => {
    const { root } = await fixture();
    const stage = join(root, ".empirical.schema5-stage-orphaned");
    const backup = join(root, ".empirical.schema4-backup-orphaned");
    await mkdir(stage);
    await mkdir(backup);
    await writeFile(join(stage, "candidate.json"), '{"schemaVersion":5}\n', "utf8");
    await writeFile(join(backup, "config.json"), '{"schemaVersion":4}\n', "utf8");
    const beforeFiles = await fileSnapshot(root);
    const beforeGit = gitSnapshot(root);

    const report = await doctorRepository(root);
    expect(report.findings).toContainEqual(expect.objectContaining({
      code: "MIGRATION_ORPHANED_SCRATCH",
      severity: "warning",
    }));
    expect(await fileSnapshot(root)).toEqual(beforeFiles);
    expect(gitSnapshot(root)).toEqual(beforeGit);
  });

  test("reports legacy policy, stale knowledge, locks, and corrupt receipts together", async () => {
    const { root } = await fixture();
    const configPath = join(root, ".empirical", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
    await writeFile(configPath, `${JSON.stringify({ ...config, schemaVersion: 4 }, null, 2)}\n`, "utf8");
    await writeFile(
      join(root, ".empirical", "policy.json"),
      `${JSON.stringify({ schemaVersion: 1, context: [], phases: {} }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(join(root, ".empirical", "inspection.lock"), "owner\n", "utf8");
    await writeFile(join(root, "README.md"), "source fingerprint changed\n", "utf8");
    const featureDirectory = join(root, ".empirical", "specs", "broken-receipts");
    await mkdir(join(featureDirectory, "evidence", "receipts"), { recursive: true });
    await writeFile(join(featureDirectory, "evidence", "receipts", "executed-bad.json"), "{}\n", "utf8");
    await writeFile(join(featureDirectory, "integration-receipt.json"), "{}\n", "utf8");
    await writeFile(join(featureDirectory, "delivery-receipt.json"), "{}\n", "utf8");
    const beforeFiles = await fileSnapshot(root);
    const report = await doctorRepository(root);
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "SCHEMA_MIGRATION_REQUIRED", severity: "warning" }),
      expect.objectContaining({ code: "POLICY_MIGRATION_REQUIRED", severity: "warning" }),
      expect.objectContaining({ code: "KNOWLEDGE_PAGES_STALE", severity: "warning" }),
      expect.objectContaining({ code: "JOURNAL_LEGACY", severity: "warning" }),
      expect.objectContaining({ code: "LOCKS_PRESENT", severity: "warning" }),
      expect.objectContaining({ code: "EVIDENCE_RECEIPT_INVALID", severity: "error" }),
      expect.objectContaining({ code: "INTEGRATION_RECEIPT_INVALID", severity: "error" }),
      expect.objectContaining({ code: "DELIVERY_RECEIPT_INVALID", severity: "error" }),
    ]));
    expect(await fileSnapshot(root)).toEqual(beforeFiles);
  });

  test("reports the shared coordination lock without removing it", async () => {
    const { root } = await fixture();
    const commonDirectory = git(root, ["rev-parse", "--git-common-dir"]).trim();
    const lockPath = join(root, commonDirectory, "empirical", "coordination.lock");
    await mkdir(join(lockPath, ".."), { recursive: true });
    await writeFile(lockPath, '{"pid":999999,"id":"abandoned"}\n', "utf8");
    const report = await doctorRepository(root);
    expect(report.findings).toContainEqual(
      expect.objectContaining({ code: "COORDINATION_LOCK_PRESENT", severity: "warning" }),
    );
    expect(await readFile(lockPath, "utf8")).toBe('{"pid":999999,"id":"abandoned"}\n');
  });

  test("rejects unsupported and malformed schema or Policy-v2 documents", async () => {
    const roots = await Promise.all([6, "malformed"].map(async (schema) => {
      const parent = await mkdtemp(join(tmpdir(), "empirical-doctor-invalid-"));
      parents.push(parent);
      const root = join(parent, "repository");
      await mkdir(join(root, ".empirical"), { recursive: true });
      await writeFile(
        join(root, ".empirical", "config.json"),
        schema === "malformed" ? "{not-json\n" : `${JSON.stringify({ schemaVersion: schema })}\n`,
        "utf8",
      );
      await writeFile(
        join(root, ".empirical", "policy.json"),
        `${JSON.stringify({ schemaVersion: 2, unknown: true })}\n`,
        "utf8",
      );
      return root;
    }));
    const reports = await Promise.all(roots.map((root) => doctorRepository(root)));
    expect(reports[0]?.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "SCHEMA_UNSUPPORTED" }),
      expect.objectContaining({ code: "POLICY_INVALID" }),
    ]));
    expect(reports[1]?.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "SCHEMA_CONFIG_INVALID" }),
      expect.objectContaining({ code: "POLICY_INVALID" }),
    ]));
  });

  test("flags terminal history without compaction and mismatched projections", async () => {
    const { root } = await fixture();
    for (const [feature, projectedRevision] of [
      ["uncompacted-terminal", 1],
      ["mismatched-projection", 2],
    ] as const) {
      const featureDirectory = join(root, ".empirical", "specs", feature);
      const eventsDirectory = join(featureDirectory, "events");
      await mkdir(eventsDirectory, { recursive: true });
      const journalState: Record<string, JsonValue> = {
        schemaVersion: 5,
        revision: 1,
        activeFeature: feature,
        phase: "done",
        status: "done",
      };
      await appendJournalEvent({
        directory: eventsDirectory,
        feature,
        actor: "tester",
        summary: "Finished without compaction",
        state: journalState,
      });
      await writeFile(
        join(featureDirectory, "state.json"),
        `${JSON.stringify({ ...journalState, revision: projectedRevision }, null, 2)}\n`,
        "utf8",
      );
    }
    const report = await doctorRepository(root);
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "JOURNAL_TERMINAL_UNCOMPACTED", scope: "journal:uncompacted-terminal" }),
      expect.objectContaining({ code: "JOURNAL_CHAIN_INVALID", scope: "journal:mismatched-projection" }),
    ]));
  });
});
