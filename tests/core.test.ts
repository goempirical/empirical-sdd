import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { EmpiricalProject, parseCriteria } from "../src/core.js";
import { resolveGitRepositoryIdentity } from "../src/coordination.js";
import { parseDecisions } from "../src/decisions.js";
import {
  publicationRequestDigest,
  type GitHubDeliveryReceipt,
  type PublicationReceipt,
} from "../src/delivery.js";
import { readJournal } from "../src/journal.js";
import { refreshRepositoryKnowledge } from "../src/knowledge.js";
import { createAuthorization, deriveCompletion, digestJson } from "../src/protocol.js";
import { PRODUCT_VERSION, SCHEMA_VERSION, type ActionPacket, type WorkflowState } from "../src/types.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function temporaryProject(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "empirical-core-"));
  directories.push(directory);
  return directory;
}

function action(value: Awaited<ReturnType<EmpiricalProject["fast"]>>): ActionPacket {
  if (value.kind !== "action") throw new Error("Expected action packet");
  return value;
}

function git(root: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", shell: false });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

async function initializeGit(root: string): Promise<void> {
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.name", "Empirical Test"]);
  git(root, ["config", "user.email", "empirical@example.test"]);
  await writeFile(join(root, "README.md"), "# Fixture\n", "utf8");
}

async function commitAll(root: string, message = "fixture"): Promise<void> {
  git(root, ["add", "."]);
  git(root, ["commit", "-m", message]);
}

async function refineKnowledge(root: string): Promise<void> {
  await Promise.all(["overview", "architecture", "commands", "conventions"].map((page) =>
    writeFile(
      join(root, ".empirical", "context", `${page}.md`),
      `# ${page}\n\nEvidence-backed fixture context.\n`,
      "utf8",
    )
  ));
  await refreshRepositoryKnowledge(root);
}

async function configureCommand(
  project: EmpiricalProject,
  evidence = { required: true, browserForUi: true, screenshotForUi: true, codeReview: true },
): Promise<void> {
  await project.configurePolicy({
    schemaVersion: 2,
    context: [],
    phases: {},
    verification: {
      evidence,
      commands: [{
        id: "verify",
        argv: [process.execPath, "-e", "process.exit(0)"],
        cwd: ".",
        timeoutMs: 30_000,
        maxOutputBytes: 65_536,
        evidenceKinds: ["test", "review"],
        criteria: [],
      }],
    },
    delivery: null,
    preferredAgent: null,
  });
}

async function acceptedDecisions(root: string, feature: string): Promise<void> {
  await writeFile(join(root, ".empirical/specs", feature, "decisions.md"), `# Decisions

## D-001: Keep the implementation local

Status: Accepted

### Evidence

The existing module owns this behavior.

### Options

1. Change the module. 2. Add a second subsystem.

### Chosen approach

Change the existing module and preserve its public boundary.

### Trade-offs and risks

Focused regression coverage mitigates the change risk.

### Verification

Run the configured command and review the public diff.
`, "utf8");
}

async function addedDelta(root: string, feature: string): Promise<void> {
  const directory = join(root, ".empirical/specs", feature, "deltas");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "example.md"), `## Purpose

This capability describes an observable example behavior for users.

## ADDED Requirements

### Requirement: Example behavior

The product MUST expose the example behavior.

#### Scenario: Successful use

- **WHEN** a user invokes it
- **THEN** the example result is returned
`, "utf8");
}

describe("Empirical 0.25 Schema-5 core", () => {
  test("exports one product/schema version and parses stable criteria", () => {
    expect(PRODUCT_VERSION).toBe("0.25.0");
    expect(SCHEMA_VERSION).toBe(5);
    expect(parseCriteria("<!--\n- [ ] [AC-X] Example only\n-->\n")).toEqual([]);
    expect(parseCriteria("- [ ] [AC-1] The result is returned\n  without losing context.\n"))
      .toEqual([{ id: "AC-1", text: "The result is returned without losing context.", ui: false, checked: false }]);
  });

  test("initialization creates Schema 5, Policy v2, Manifest v2, and no root workflow projection", async () => {
    const root = await temporaryProject();
    const initialized = await EmpiricalProject.initialize(root, { integrations: false, setupComplete: true });
    expect(initialized.state).toMatchObject({ schemaVersion: 5, phase: "idle", revision: 0 });
    expect(await initialized.project.config()).toMatchObject({ schemaVersion: 5, setupComplete: true });
    expect(await initialized.project.policy()).toMatchObject({ schemaVersion: 2, delivery: null });
    expect(JSON.parse(await readFile(join(root, ".empirical/context/manifest.json"), "utf8")))
      .toMatchObject({ schemaVersion: 2 });
    expect(await stat(join(root, ".empirical/state.json")).then(() => true, () => false)).toBe(false);
  });

  test("configuration and Policy v2 are durable, strict, and repository-contained", async () => {
    const root = await temporaryProject();
    const { project } = await EmpiricalProject.initialize(root, { integrations: false });
    const configured = await project.configure({
      evidence: { required: false, browserForUi: false },
      isolation: { mode: "off", baseBranch: "main", worktreePath: "../sandbox-{feature}", branchPattern: "{type}/alpha-{feature}" },
      decisions: { complexRecords: "off" },
      interaction: { questions: "concise" },
    });
    expect(configured.interaction.questions).toBe("concise");
    expect(action(await project.fast("Add a configured interaction fixture")).interaction)
      .toEqual({ questions: "concise" });
    expect((await EmpiricalProject.open(root)).config()).resolves.toEqual(configured);
    await expect(project.configure({ isolation: { worktreePath: "../fixed" } }))
      .rejects.toMatchObject({ code: "INVALID_CONFIG" });
    await expect(project.configurePolicy({
      schemaVersion: 2,
      context: [], phases: {},
      verification: { evidence: configured.evidence, commands: [{ id: "bad", argv: ["sh", "-c", "true"], cwd: ".", timeoutMs: 1000, maxOutputBytes: 1000, criteria: [] }] },
      delivery: null, preferredAgent: null,
    })).rejects.toThrow("may not invoke a shell");
    await writeFile(
      join(root, ".empirical", "policy.json"),
      `${JSON.stringify({
        schemaVersion: 2,
        context: [],
        phases: {},
        verification: {
          evidence: configured.evidence,
          commands: [{
            id: "unsafe",
            argv: ["sh", "-c", "true"],
            cwd: ".",
            timeoutMs: 1000,
            maxOutputBytes: 1000,
            evidenceKinds: ["test"],
            criteria: [],
          }],
        },
        delivery: null,
        preferredAgent: null,
      }, null, 2)}\n`,
      "utf8",
    );
    await expect(project.policy()).rejects.toMatchObject({ code: "INVALID_POLICY" });
  });

  test("Schema-5 configuration without interaction stays detailed and is not rewritten on read", async () => {
    const root = await temporaryProject();
    const { project } = await EmpiricalProject.initialize(root, { integrations: false });
    const path = join(root, ".empirical", "config.json");
    const raw = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    delete raw.interaction;
    await writeFile(path, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
    const before = await readFile(path, "utf8");

    expect((await project.config()).interaction).toEqual({ questions: "detailed" });
    expect(await readFile(path, "utf8")).toBe(before);
  });

  test("Fast completion accepts only immutable receipts and derives verified completion", async () => {
    const root = await temporaryProject();
    const { project } = await EmpiricalProject.initialize(root, { integrations: false });
    await configureCommand(project);
    const started = action(await project.fast("Fix a docs punctuation typo"));
    expect(started).toMatchObject({ phase: "implement", riskFloor: "contract-neutral" });
    await expect(project.complete({
      revision: started.revision,
      outcome: "passed",
      summary: "Caller asserted evidence",
      evidence: [{ criterionId: "AC-1", kind: "test", passed: true, summary: "claimed" }],
    })).rejects.toMatchObject({ code: "INVALID_EVIDENCE" });
    await expect(project.executeEvidence({
      commandId: "verify",
      criteria: ["AC-1"],
      evidenceKinds: ["human"],
      summary: "Caller tried to widen the configured command",
    })).rejects.toMatchObject({ code: "INVALID_EVIDENCE" });
    await writeFile(join(root, "claimed-test.txt"), "not an executed test\n", "utf8");
    const collected = await project.collectEvidence({
      criteria: ["AC-1"],
      evidenceKinds: ["test", "review"],
      summary: "A caller labeled an arbitrary artifact as test output",
      collector: "caller",
      artifacts: [{ path: "claimed-test.txt", mediaType: "text/plain" }],
    });
    await expect(project.complete({
      revision: started.revision,
      outcome: "passed",
      summary: "Collected-only evidence must not satisfy tests",
      receiptIds: [collected.id],
    })).rejects.toThrow("no passing test evidence");
    const receipt = await project.executeEvidence({
      commandId: "verify",
      criteria: ["AC-1"],
      evidenceKinds: ["test", "review"],
      summary: "Focused verification and independent diff review passed",
    });
    const context = await project.complete({
      revision: started.revision,
      outcome: "passed",
      summary: "Implemented and verified",
      receiptIds: [receipt.id],
    });
    expect(context).toMatchObject({
      phase: "context",
      status: "waiting",
      completionLevel: { highest: "verified" },
    });
    expect(context.instructions).toContain("refinement-required TODO topic");
    await expect(project.complete({
      revision: context.revision,
      outcome: "passed",
      summary: "Context is not refined",
    })).rejects.toMatchObject({ code: "CONTEXT_REFINEMENT_REQUIRED" });
    expect((await project.context()).refinementRequired).toHaveLength(4);
    await refineKnowledge(root);
    const completed = await project.complete({
      revision: context.revision,
      outcome: "passed",
      summary: "Refreshed and refined repository knowledge",
    });
    expect(completed).toMatchObject({ phase: "done", status: "done", completionLevel: { highest: "verified" } });
    const featureDirectory = join(root, ".empirical/specs", started.feature!);
    expect((await readdir(featureDirectory)).sort()).toEqual(["events", "evidence", "impact.json", "spec.md", "state.json"]);
    const journal = await readJournal(join(featureDirectory, "events"), started.feature!);
    expect(journal.snapshot?.state).toMatchObject({ phase: "done", status: "done" });
    expect(journal.events).toHaveLength(1);
    expect(journal.events[0]?.type).toBe("compaction-boundary");
  });

  test("Fast failure promotes to Complex and clears unproven completion", async () => {
    const root = await temporaryProject();
    const { project } = await EmpiricalProject.initialize(root, { integrations: false });
    const started = action(await project.fast("Rename a local docs variable"));
    const promoted = await project.complete({
      revision: started.revision,
      outcome: "failed",
      summary: "The change affects observable behavior",
    });
    expect(promoted).toMatchObject({ profile: "complex", phase: "specify", completionLevel: { highest: "none" } });
  });

  test("source-neutral Fast work skips the Context phase", async () => {
    const root = await temporaryProject();
    const { project } = await EmpiricalProject.initialize(root, { integrations: false });
    await configureCommand(project);
    const started = action(await project.fast("Normalize internal metadata only"));
    const receipt = await project.executeEvidence({
      commandId: "verify",
      criteria: ["AC-1"],
      evidenceKinds: ["test", "review"],
      summary: "Source-neutral verification passed",
    });
    const completed = await project.complete({
      revision: started.revision,
      outcome: "passed",
      summary: "Changed only excluded Empirical state",
      receiptIds: [receipt.id],
    });
    expect(completed).toMatchObject({ phase: "done", status: "done" });
  });

  test("UI evidence reflects configured browser and screenshot policy", async () => {
    const root = await temporaryProject();
    const { project } = await EmpiricalProject.initialize(root, {
      integrations: false,
      evidence: { required: true, browserForUi: false, screenshotForUi: true, codeReview: false },
    });
    const started = action(await project.fast("[UI] Format comments only in a local preview"));
    expect(started.acceptanceCriteria[0]?.ui).toBe(true);
    expect(started.requiredEvidence).toEqual(["test", "screenshot"]);
  });

  test("Complex Specify finalizes behavioral impact, validates decisions, and claims capabilities", async () => {
    const root = await temporaryProject();
    await initializeGit(root);
    const { project } = await EmpiricalProject.initialize(root, { integrations: false });
    await commitAll(root, "initialize");
    let current = action(await project.complex("Add a durable example capability"));
    const feature = current.feature!;
    await writeFile(join(root, ".empirical/specs", feature, "spec.md"), "# Example\n\n## Acceptance Criteria\n\n- [ ] [AC-1] The example is observable.\n", "utf8");
    await addedDelta(root, feature);
    current = await project.complete({ revision: current.revision, outcome: "passed", summary: "Specified" });
    expect(current.phase).toBe("design");
    const state = await project.status();
    expect(state).toMatchObject({ capabilityArchiveRequired: true, approvedSpecRevision: 2 });
    expect(state.capabilityClaimId).toMatch(/^add-a-durable-example-capability-/);
    expect(JSON.parse(await readFile(join(root, ".empirical/specs", feature, "impact.json"), "utf8")))
      .toMatchObject({ classification: "behavioral", capabilities: ["example"] });
    await writeFile(join(root, ".empirical/specs", feature, "design.md"), "# Design\n\nKeep ownership local.\n", "utf8");
    await expect(project.complete({ revision: current.revision, outcome: "passed", summary: "Designed" }))
      .rejects.toMatchObject({ code: "DECISIONS_REQUIRED" });
    await acceptedDecisions(root, feature);
    expect((await project.complete({ revision: current.revision, outcome: "passed", summary: "Designed" })).phase).toBe("plan");
  });

  test("Complex source changes route through Context before Verify", async () => {
    const root = await temporaryProject();
    await initializeGit(root);
    const { project } = await EmpiricalProject.initialize(root, { integrations: false });
    await refineKnowledge(root);
    await commitAll(root, "initialize refined context");
    let current = action(await project.complex("Add a context-gated example behavior"));
    const feature = current.feature!;
    await writeFile(
      join(root, ".empirical/specs", feature, "spec.md"),
      "# Context gate\n\n## Acceptance Criteria\n\n- [ ] [AC-1] Source changes require current context.\n",
      "utf8",
    );
    await addedDelta(root, feature);
    current = await project.complete({ revision: current.revision, outcome: "passed", summary: "Specified" });
    await acceptedDecisions(root, feature);
    await writeFile(join(root, ".empirical/specs", feature, "design.md"), "# Design\n\nUse the existing workflow.\n", "utf8");
    current = await project.complete({ revision: current.revision, outcome: "passed", summary: "Designed" });
    await writeFile(join(root, ".empirical/specs", feature, "plan.md"), "# Plan\n\nImplement and refresh context.\n", "utf8");
    current = await project.complete({ revision: current.revision, outcome: "passed", summary: "Planned" });
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "example.ts"), "export const example = true;\n", "utf8");
    current = await project.complete({ revision: current.revision, outcome: "passed", summary: "Implemented" });
    expect(current).toMatchObject({ phase: "context", status: "waiting" });
    await expect(project.complete({
      revision: current.revision,
      outcome: "passed",
      summary: "Skipped refresh",
    })).rejects.toMatchObject({ code: "CONTEXT_REFINEMENT_REQUIRED" });
    expect((await project.context()).refinementRequired).toEqual([]);
    current = await project.complete({
      revision: current.revision,
      outcome: "passed",
      summary: "Refreshed current context",
    });
    expect(current.phase).toBe("verify");
  });

  test("non-Git behavioral Specify stops at the capability-claim safety boundary", async () => {
    const root = await temporaryProject();
    const { project } = await EmpiricalProject.initialize(root, { integrations: false });
    const started = action(await project.complex("Add a behavioral example"));
    await writeFile(join(root, ".empirical/specs", started.feature!, "spec.md"), "# Example\n\n## Acceptance Criteria\n\n- [ ] [AC-1] Behavior exists.\n", "utf8");
    await addedDelta(root, started.feature!);
    await expect(project.complete({ revision: started.revision, outcome: "passed", summary: "Specified" }))
      .rejects.toMatchObject({ code: "CAPABILITY_CLAIM_REQUIRED" });
  });

  test("YOLO records one bounded immutable authorization and never infers publication", async () => {
    const root = await temporaryProject();
    const { project } = await EmpiricalProject.initialize(root, { integrations: false });
    await expect(project.yolo("Fix a docs punctuation typo", { ceiling: "implemented" }))
      .rejects.toMatchObject({ code: "YOLO_CEILING_UNREACHABLE" });
    expect(await project.status()).toMatchObject({ phase: "idle", activeFeature: null });
    const started = action(await project.yolo("Fix a docs punctuation typo", { ceiling: "integrated" }));
    expect(started).toMatchObject({ mode: "yolo", completionLevel: { highest: "none" } });
    const state = await project.status();
    const authorization = JSON.parse(await readFile(join(root, ".empirical/specs", started.feature!, "authorization.json"), "utf8"));
    expect(authorization).toMatchObject({ mode: "yolo", ceiling: "integrated" });
    expect(state.authorizationDigest).toBe(authorization.digest);
    expect(action(await project.yolo("Fix a docs punctuation typo", { ceiling: "integrated" })).revision)
      .toBe(started.revision);
    await expect(project.yolo("Fix a docs punctuation typo", { ceiling: "published" } as never))
      .rejects.toMatchObject({ code: "PUBLICATION_AUTHORIZATION_REQUIRED" });
  });

  test("YOLO pauses durably at a partial ceiling and explicit retry resumes normal mode", async () => {
    const root = await temporaryProject();
    const { project } = await EmpiricalProject.initialize(root, { integrations: false });
    let current = action(await project.yolo("Refactor the internal parser architecture", {
      ceiling: "implemented",
    }));
    const feature = current.feature!;
    await writeFile(
      join(root, ".empirical/specs", feature, "spec.md"),
      "# Internal parser refactor\n\n## Acceptance Criteria\n\n- [ ] [AC-1] Existing parser behavior remains unchanged.\n",
      "utf8",
    );
    await writeFile(
      join(root, ".empirical/specs", feature, "impact.json"),
      `${JSON.stringify({
        classification: "non-behavioral",
        surfaces: ["internal-parser"],
        regressionRationale: "The refactor preserves every observable parser result under focused regression tests.",
      }, null, 2)}\n`,
      "utf8",
    );
    current = await project.complete({ revision: current.revision, outcome: "passed", summary: "Specified" });
    await writeFile(join(root, ".empirical/specs", feature, "design.md"), "# Design\n\nKeep parser ownership local.\n", "utf8");
    await acceptedDecisions(root, feature);
    current = await project.complete({ revision: current.revision, outcome: "passed", summary: "Designed" });
    await writeFile(join(root, ".empirical/specs", feature, "plan.md"), "# Plan\n\nRefactor and run regressions.\n", "utf8");
    current = await project.complete({ revision: current.revision, outcome: "passed", summary: "Planned" });
    current = await project.complete({ revision: current.revision, outcome: "passed", summary: "Implemented" });
    expect(current).toMatchObject({
      phase: "verify",
      status: "awaiting_human",
      mode: "yolo",
      completionLevel: { highest: "implemented" },
    });
    await expect(project.complete({ revision: current.revision, outcome: "passed", summary: "Over ceiling" }))
      .rejects.toMatchObject({ code: "AWAITING_HUMAN" });
    const resumed = await project.retry(current.revision, "human");
    expect(resumed).toMatchObject({ phase: "verify", status: "waiting", mode: "normal" });
    expect((await project.status()).authorizationDigest).toBeNull();
  });

  test("publication adopts an exact immutable receipt and transitions a delivered terminal feature idempotently", async () => {
    const root = await temporaryProject();
    await initializeGit(root);
    const { project } = await EmpiricalProject.initialize(root, { integrations: false });
    await commitAll(root, "initialize publication fixture");
    const started = action(await project.complex("Prepare an explicitly requested immutable release"));
    const feature = started.feature!;
    const delivered = await project.store.transition(
      started.revision,
      "fixture",
      "Seed independently delivered state",
      (state) => ({
        ...state,
        phase: "done",
        status: "done",
        completion: deriveCompletion({
          implemented: true,
          verified: true,
          integrated: true,
          delivered: true,
          published: false,
        }),
      }),
    );
    const identity = await resolveGitRepositoryIdentity(root);
    const commit = git(root, ["rev-parse", "HEAD"]);
    const packageName = "empirical-fixture";
    const version = "1.2.3";
    const distTag = "latest";
    const authorization = createAuthorization({
      repositoryId: identity.repositoryId,
      feature,
      requestDigest: publicationRequestDigest({
        repositoryId: identity.repositoryId,
        feature,
        packageName,
        version,
        distTag,
        commit,
      }),
      ceiling: "published",
      targetBranch: "main",
      allowExternalAgent: false,
      createdAt: "2026-08-03T12:00:00.000Z",
      expiresAt: null,
    });
    const deliveryBody: Omit<GitHubDeliveryReceipt, "digest"> = {
      schemaVersion: 1,
      repositoryId: identity.repositoryId,
      feature,
      targetBranch: "main",
      source: {
        number: 11,
        url: "https://example.test/source/11",
        state: "MERGED",
        commit,
        mergeCommit: commit,
      },
      evidence: {
        number: 12,
        url: "https://example.test/evidence/12",
        state: "MERGED",
        commit,
        mergeCommit: commit,
      },
      requiredChecks: ["ci"],
      commandReceiptDigests: [digestJson({ command: "delivery" })],
      deliveredAt: "2026-08-03T12:01:00.000Z",
    };
    const publicationBody: Omit<PublicationReceipt, "digest"> = {
      schemaVersion: 1,
      repositoryId: identity.repositoryId,
      feature,
      authorizationDigest: authorization.digest,
      planDigest: digestJson({ operation: "publish", version }),
      packageName,
      version,
      tag: `v${version}`,
      distTag,
      commit,
      commandReceiptDigests: [digestJson({ command: "publication-observation" })],
      publishedAt: "2026-08-03T12:02:00.000Z",
    };
    const featureDirectory = join(root, ".empirical", "specs", feature);
    await writeFile(
      join(featureDirectory, "delivery-receipt.json"),
      `${JSON.stringify({ ...deliveryBody, digest: digestJson(deliveryBody) }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      join(featureDirectory, "publication-receipt.json"),
      `${JSON.stringify({ ...publicationBody, digest: digestJson(publicationBody) }, null, 2)}\n`,
      "utf8",
    );
    const selected = await EmpiricalProject.open(root, { feature });
    const input = {
      revision: delivered.revision,
      authorization,
      packageName,
      version,
      distTag,
      commit,
      approved: true as const,
      actor: "publisher",
    };
    const published = await selected.publish(input);
    expect(published.action).toMatchObject({
      phase: "done",
      status: "done",
      revision: delivered.revision + 1,
      completionLevel: { highest: "published" },
    });
    expect(published.receipt).toMatchObject({ packageName, version, commit });
    expect(await readFile(join(featureDirectory, "publication-authorization.json"), "utf8"))
      .toContain(authorization.digest);
    expect(await selected.publish(input)).toEqual(published);
    const journal = await readJournal(join(featureDirectory, "events"), feature);
    expect(journal.snapshot?.state).toMatchObject({
      phase: "done",
      completion: { highest: "published" },
    });
    expect(journal.events).toHaveLength(1);
  });

  test("Explain is read-only and reports deterministic routing and context gaps", async () => {
    const root = await temporaryProject();
    const { project } = await EmpiricalProject.initialize(root, { integrations: false });
    const started = action(await project.complex("Explain an active decision"));
    await acceptedDecisions(root, started.feature!);
    const statePath = join(root, ".empirical/specs", started.feature!, "state.json");
    const before = await readFile(statePath, "utf8");
    const report = await project.explain();
    expect(report).toMatchObject({ feature: started.feature, phase: "specify", rationale: { gate: "proceed" } });
    expect(await readFile(statePath, "utf8")).toBe(before);
  });

  test("exact revisions, evidence gates, and concurrent identical starters remain deterministic", async () => {
    const root = await temporaryProject();
    const { project } = await EmpiricalProject.initialize(root, { integrations: false });
    const values = await Promise.all(Array.from({ length: 6 }, () => project.fast("Fix a comments-only typo")));
    for (const value of values) expect(value).toEqual(values[0]);
    const started = action(values[0]!);
    await expect(project.complete({ revision: 0, outcome: "passed", summary: "stale" }))
      .rejects.toMatchObject({ code: "STALE_REVISION" });
    await expect(project.complete({ revision: started.revision, outcome: "passed", summary: "missing" }))
      .rejects.toMatchObject({ code: "EVIDENCE_REQUIRED" });
    expect(await readdir(join(root, ".empirical/specs", started.feature!, "events"))).toEqual(["00000001.json"]);
  });

  test("Schema 5 rejects mixed legacy root state instead of performing partial compatibility migration", async () => {
    const root = await temporaryProject();
    const { project } = await EmpiricalProject.initialize(root, { integrations: false });
    await writeFile(join(root, ".empirical/state.json"), `${JSON.stringify(await project.status())}\n`, "utf8");
    await expect(EmpiricalProject.open(root)).rejects.toMatchObject({ code: "MIGRATION_CONFLICT" });
    await expect(EmpiricalProject.openReadOnly(root)).rejects.toMatchObject({ code: "MIGRATION_REQUIRED" });
  });

  test("Schema 5 read-only access rejects mixed feature state", async () => {
    const root = await temporaryProject();
    await EmpiricalProject.initialize(root, { integrations: false });
    const directory = join(root, ".empirical/specs/mixed-feature");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "state.json"),
      `${JSON.stringify({ schemaVersion: 4, activeFeature: "mixed-feature" })}\n`,
      "utf8",
    );
    await expect(EmpiricalProject.openReadOnly(root)).rejects.toMatchObject({
      code: "MIGRATION_REQUIRED",
    });
  });

  test("feature creation refuses symlink destinations and recovery rejects ambiguous histories", async () => {
    const root = await temporaryProject();
    const outside = await temporaryProject();
    const { project } = await EmpiricalProject.initialize(root, { integrations: false });
    await symlink(outside, join(root, ".empirical/specs/redirected-feature"), "dir");
    await expect(project.fast("Create redirected feature", { id: "redirected-feature" }))
      .rejects.toMatchObject({ code: "UNSAFE_SPEC_PATH" });
    await unlink(join(root, ".empirical/specs/redirected-feature"));
    const started = action(await project.fast("Fix a first comments-only typo"));
    const first = join(root, ".empirical/specs", started.feature!);
    const secondFeature = "second-unclaimed-feature";
    const second = join(root, ".empirical/specs", secondFeature);
    await mkdir(second, { recursive: true });
    const state = JSON.parse(await readFile(join(first, "state.json"), "utf8")) as WorkflowState;
    await writeFile(join(second, "spec.md"), "# Second\n\n## Acceptance Criteria\n\n- [ ] [AC-1] Second is observable.\n", "utf8");
    await writeFile(join(second, "state.json"), `${JSON.stringify({ ...state, activeFeature: secondFeature, request: "Second" })}\n`, "utf8");
    await expect(EmpiricalProject.open(root)).rejects.toMatchObject({ code: "MULTIPLE_ACTIVE_FEATURES" });
  });

  test("decision parser rejects hidden reasoning and broken supersession", () => {
    const report = parseDecisions("## D-001: Unsafe trace\n\nStatus: Superseded\n\n### Chain of thought\nsecret\n\n### Evidence\nfact\n\n### Options\na or b\n\n### Chosen approach\na\n\n### Trade-offs and risks\nrisk\n\n### Verification\ntest\n");
    expect(report.valid).toBe(false);
    expect(report.issues.join(" ")).toContain("hidden-reasoning");
    expect(report.issues.join(" ")).toContain("Superseded by");
  });

  test("project integration adds local activation and v1 adoption remains non-destructive", async () => {
    const root = await temporaryProject();
    const { integrations } = await EmpiricalProject.initialize(root);
    expect(integrations.entrypoints).toEqual([]);
    expect(await readFile(join(root, ".mcp.json"), "utf8")).toContain("empirical");
    expect(await readFile(join(root, ".agents/skills/empirical/SKILL.md"), "utf8"))
      .toContain("Automatically route, track, resume, and complete Empirical work");

    const legacy = await temporaryProject();
    await mkdir(join(legacy, "ai/specs/legacy-feature"), { recursive: true });
    await writeFile(join(legacy, "ai/STATE.md"), "current_spec: legacy-feature\ncurrent_phase: implementation\n", "utf8");
    await writeFile(join(legacy, "ai/specs/legacy-feature/spec.md"), "# Legacy\n", "utf8");
    const adopted = await EmpiricalProject.adopt(legacy, { integrations: false });
    expect(await adopted.project.status()).toMatchObject({ activeFeature: "legacy-feature", phase: "implement" });
    expect(await readFile(join(legacy, "ai/STATE.md"), "utf8")).toContain("legacy-feature");

    const finishedLegacy = await temporaryProject();
    await mkdir(join(finishedLegacy, "ai/specs/finished-feature"), { recursive: true });
    await writeFile(join(finishedLegacy, "ai/STATE.md"), "current_spec: finished-feature\ncurrent_phase: done\n", "utf8");
    await writeFile(join(finishedLegacy, "ai/specs/finished-feature/spec.md"), "# Finished\n", "utf8");
    const finished = await EmpiricalProject.adopt(finishedLegacy, { integrations: false });
    expect(await finished.project.status()).toMatchObject({ phase: "done", status: "done" });
    const journal = await readJournal(
      join(finishedLegacy, ".empirical/specs/finished-feature/events"),
      "finished-feature",
    );
    expect(journal.snapshot).not.toBeNull();
    expect(journal.events.map((event) => event.type)).toEqual(["compaction-boundary"]);
  });
});
