import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readJournal } from "../src/journal.js";
import { ProjectStore } from "../src/storage.js";
import { capabilityDeltaDigest } from "../src/specifications.js";
import {
  migrateSchema4To5,
  recoverSchema5Migration,
  type MigrationFaultPoint,
} from "../src/migration.js";
import type { JsonValue } from "../src/protocol.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function legacyState(feature: string, profile: "fast" | "complex", phase = "implement") {
  return {
    schemaVersion: 4,
    revision: 1,
    activeFeature: feature,
    request: `Implement ${feature}`,
    profile,
    phase,
    status: phase === "done" ? "done" : "waiting",
    repairAttempts: 0,
    message: null,
    implementationActor: null,
    specDigest: "a".repeat(64),
    capabilityArchiveRequired: profile === "complex",
    capabilityDeltaDigest: profile === "complex" ? "b".repeat(64) : null,
    evidence: [{ criterionId: "AC-1", kind: "test", passed: true, summary: "legacy" }],
    updatedAt: "2026-08-03T10:00:00.000Z",
  };
}

async function schema4Fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "empirical-migration-"));
  roots.push(root);
  const empirical = join(root, ".empirical");
  await writeJson(join(empirical, "config.json"), {
    schemaVersion: 4,
    profile: "complex",
    maxRepairAttempts: 2,
    evidence: {
      required: true,
      browserForUi: false,
      screenshotForUi: true,
      codeReview: true,
    },
    isolation: {
      mode: "ask",
      baseBranch: "auto",
      worktreePath: "../{repo}-{feature}",
      branchPattern: "{type}/{feature}",
    },
    decisions: { complexRecords: "required" },
    setupComplete: true,
    legacySource: null,
  });
  await writeJson(join(empirical, "policy.json"), {
    schemaVersion: 1,
    context: ["Keep operations local"],
    phases: { implement: ["Run tests"] },
  });
  await mkdir(join(empirical, "context"), { recursive: true });
  await writeJson(join(empirical, "context", "manifest.json"), {
    schemaVersion: 1,
    digest: "c".repeat(64),
    files: [{ path: "README.md", size: 5, digest: "d".repeat(64) }],
    truncated: false,
  });
  await writeFile(
    join(empirical, "context", "overview.md"),
    `# Project Overview

Maintain this page from repository evidence.

## Purpose

- TODO: What the project does and who it serves.

## Boundaries

- TODO: Major scope boundaries and explicit non-goals.

## Evidence

- TODO: Link the manifests, documentation, and entrypoints used.
`,
    "utf8",
  );
  for (const page of ["architecture", "commands", "conventions"]) {
    await writeFile(join(empirical, "context", `${page}.md`), `# ${page}\n`, "utf8");
  }

  const complex = "complex-feature";
  const complexDirectory = join(empirical, "specs", complex);
  await mkdir(join(complexDirectory, "events"), { recursive: true });
  await mkdir(join(complexDirectory, "deltas"), { recursive: true });
  await writeFile(
    join(complexDirectory, "spec.md"),
    "# Feature\n\n- [ ] [AC-1] It works.\n",
    "utf8",
  );
  await writeFile(
    join(complexDirectory, "deltas", "example.md"),
    "## ADDED Requirements\n\n### Requirement: Example\n\n#### Scenario: Works\n",
    "utf8",
  );
  const complexState = legacyState(complex, "complex");
  await writeJson(join(complexDirectory, "state.json"), complexState);
  const historicalState = {
    ...complexState,
    schemaVersion: 3,
    revision: 0,
    activeFeature: null,
    request: null,
    phase: "idle",
    status: "idle",
    specDigest: null,
    capabilityArchiveRequired: false,
    capabilityDeltaDigest: null,
    evidence: [],
  };
  await writeJson(join(complexDirectory, "events", "00000000.json"), {
    schemaVersion: 3,
    revision: 0,
    previousRevision: -1,
    actor: "historical-tester",
    summary: "Started under Schema 3",
    createdAt: "2026-08-03T09:59:00.000Z",
    state: historicalState,
  });
  await writeJson(join(complexDirectory, "events", "00000001.json"), {
    schemaVersion: 4,
    revision: 1,
    previousRevision: -1,
    actor: "tester",
    summary: "Started",
    createdAt: "2026-08-03T10:00:00.000Z",
    state: complexState,
  });
  await writeJson(join(complexDirectory, "evidence.json"), complexState.evidence);

  const fast = "fast-feature";
  const fastDirectory = join(empirical, "specs", fast);
  await mkdir(join(fastDirectory, "events"), { recursive: true });
  await writeFile(
    join(fastDirectory, "spec.md"),
    "# Fast\n\n- [ ] [AC-1] It works.\n",
    "utf8",
  );
  const fastState = legacyState(fast, "fast", "done");
  await writeJson(join(fastDirectory, "state.json"), fastState);
  await writeJson(join(fastDirectory, "events", "00000001.json"), {
    schemaVersion: 4,
    revision: 1,
    previousRevision: -1,
    actor: "tester",
    summary: "Done",
    createdAt: "2026-08-03T10:00:00.000Z",
    state: fastState,
  });
  return root;
}

async function json(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

describe("atomic Schema-4 to Schema-5 migration", () => {
  test("transforms configuration, policy, manifest, features, journals, impact, and legacy evidence", async () => {
    const root = await schema4Fixture();
    const report = await migrateSchema4To5(root, {
      now: () => new Date("2026-08-03T12:00:00Z"),
    });
    expect(report).toMatchObject({
      from: 4,
      to: 5,
      changed: true,
      recovered: false,
      features: 2,
      receipt: ".empirical/migrations/schema-4-to-5.json",
    });
    const empirical = join(root, ".empirical");
    expect(await json(join(empirical, "config.json"))).toMatchObject({
      schemaVersion: 5,
      migratedFrom: { schemaVersion: 4, migratedAt: "2026-08-03T12:00:00.000Z" },
    });
    expect(await json(join(empirical, "policy.json"))).toMatchObject({
      schemaVersion: 2,
      context: ["Keep operations local"],
      verification: {
        evidence: {
          required: true,
          browserForUi: false,
          screenshotForUi: true,
          codeReview: true,
        },
        commands: [],
      },
      delivery: null,
      preferredAgent: null,
    });
    expect(await json(join(empirical, "context", "manifest.json"))).toMatchObject({
      schemaVersion: 2,
      generator: "empirical-0.23.0",
      pages: expect.arrayContaining([
        expect.objectContaining({
          path: ".empirical/context/overview.md",
          freshness: "fresh",
          managed: true,
        }),
        expect.objectContaining({
          path: ".empirical/context/architecture.md",
          managed: false,
        }),
      ]),
    });
    expect((await readFile(join(empirical, "context", "overview.md"), "utf8"))
      .startsWith("<!-- empirical-sdd:managed-context-v2 -->\n")).toBe(true);
    expect(await readFile(join(empirical, "context", "architecture.md"), "utf8"))
      .toBe("# architecture\n");
    const state = await json(join(empirical, "specs", "complex-feature", "state.json"));
    expect(state).toMatchObject({
      schemaVersion: 5,
      workflow: "complex",
      mode: "normal",
      authorizationDigest: null,
      evidenceReceiptIds: [],
      legacyEvidenceCount: 1,
      completion: {
        implemented: false,
        verified: false,
        integrated: false,
        delivered: false,
        published: false,
      },
    });
    expect(String(state.specDigest)).toStartWith("sha256:");
    expect(state.capabilityDeltaDigest).toBe(
      await capabilityDeltaDigest(new ProjectStore(root), "complex-feature"),
    );
    expect(await json(join(empirical, "specs", "complex-feature", "impact.json"))).toMatchObject({
      classification: "behavioral",
      capabilities: ["example"],
    });
    expect(
      await json(
        join(empirical, "specs", "complex-feature", "evidence", "legacy-import.json"),
      ),
    ).toMatchObject({ kind: "collected-legacy", satisfiesVerification: false });
    const journal = await readJournal<Record<string, JsonValue>>(
      join(empirical, "specs", "complex-feature", "events"),
      "complex-feature",
    );
    expect(journal.events).toHaveLength(2);
    expect(journal.events.map((event) => event.type)).toEqual(["migration", "migration"]);
    expect(journal.events[0]?.state).toMatchObject({ schemaVersion: 5, revision: 0 });
    expect(journal.state?.schemaVersion).toBe(5);
    const terminalJournal = await readJournal<JsonValue>(
      join(empirical, "specs", "fast-feature", "events"),
      "fast-feature",
    );
    expect(terminalJournal.snapshot?.state).toMatchObject({ phase: "done", status: "done" });
    expect(terminalJournal.events.map((event) => event.type)).toEqual(["compaction-boundary"]);
    expect(await stat(join(empirical, "migrations", "schema-4-to-5.json"))).toBeDefined();
    expect((await readdir(root)).filter((name) => name.includes("schema5-") || name.includes("schema4-backup"))).toEqual([]);

    const converged = await migrateSchema4To5(root);
    expect(converged).toMatchObject({ from: 5, to: 5, changed: false });
  });

  test("recovers deterministically from every directory-swap interruption", async () => {
    for (const faultAt of [
      "after-prepare",
      "after-backup",
      "after-promote",
    ] satisfies MigrationFaultPoint[]) {
      const root = await schema4Fixture();
      await expect(
        migrateSchema4To5(root, {
          faultAt,
          now: () => new Date("2026-08-03T12:00:00Z"),
        }),
      ).rejects.toThrow(`Injected migration fault: ${faultAt}`);
      const recovered = await recoverSchema5Migration(root);
      expect(recovered).toMatchObject({
        from: 4,
        to: 5,
        changed: true,
        recovered: true,
        features: 2,
      });
      expect(await json(join(root, ".empirical", "config.json"))).toMatchObject({
        schemaVersion: 5,
      });
      expect(await stat(join(root, ".empirical.schema5-migration.json")).then(() => true, () => false)).toBe(false);
    }
  });

  test("preflight refuses symlinks without changing Schema-4 source", async () => {
    const root = await schema4Fixture();
    const configPath = join(root, ".empirical", "config.json");
    const before = await readFile(configPath, "utf8");
    await symlink(configPath, join(root, ".empirical", "linked-config"));
    await expect(migrateSchema4To5(root)).rejects.toThrow("refuses symbolic links");
    expect(await readFile(configPath, "utf8")).toBe(before);
    expect(await json(configPath)).toMatchObject({ schemaVersion: 4 });
    expect(await stat(join(root, ".empirical.schema5-migration.json")).then(() => true, () => false)).toBe(false);
  });

  test("preflight refuses a symbolic .empirical root", async () => {
    const root = await schema4Fixture();
    const source = join(root, ".empirical");
    const moved = join(root, "external-empirical");
    await rename(source, moved);
    await symlink(moved, source, "junction");
    await expect(migrateSchema4To5(root)).rejects.toThrow("must be a real directory");
    expect(await json(join(moved, "config.json"))).toMatchObject({ schemaVersion: 4 });
  });

  test("rejects unsupported source schemas before creating migration state", async () => {
    const root = await schema4Fixture();
    const path = join(root, ".empirical", "config.json");
    const config = await json(path);
    await writeJson(path, { ...config, schemaVersion: 3 });
    await expect(migrateSchema4To5(root)).rejects.toThrow("Only Schema 4");
    expect(await stat(join(root, ".empirical.schema5-migration.json")).then(() => true, () => false)).toBe(false);
  });

  test("removes its unmarked stage when candidate transformation fails", async () => {
    const root = await schema4Fixture();
    const eventPath = join(
      root,
      ".empirical",
      "specs",
      "complex-feature",
      "events",
      "00000000.json",
    );
    const event = await json(eventPath);
    const state = event.state as Record<string, unknown>;
    const unsupported = {
      ...event,
      schemaVersion: 2,
      state: { ...state, schemaVersion: 2 },
    };
    await writeJson(eventPath, unsupported);
    const before = await readFile(eventPath, "utf8");

    await expect(migrateSchema4To5(root)).rejects.toThrow(
      "unsupported historical event schema",
    );
    expect(await readFile(eventPath, "utf8")).toBe(before);
    expect((await json(join(root, ".empirical", "config.json"))).schemaVersion).toBe(4);
    expect(
      (await readdir(root)).filter((name) =>
        name.startsWith(".empirical.schema5-")
        || name.startsWith(".empirical.schema4-backup-")
      ),
    ).toEqual([]);
  });

  test("recovery refuses tampered Policy-v2 and Manifest-v2 candidates and restores Schema 4", async () => {
    for (const target of ["policy", "manifest"] as const) {
      const root = await schema4Fixture();
      await expect(migrateSchema4To5(root, { faultAt: "after-prepare" })).rejects.toThrow(
        "Injected migration fault: after-prepare",
      );
      const marker = await json(join(root, ".empirical.schema5-migration.json"));
      const stage = String(marker.stage);
      const path = target === "policy"
        ? join(stage, "policy.json")
        : join(stage, "context", "manifest.json");
      const value = await json(path);
      await writeJson(path, target === "policy" ? { ...value, unknown: true } : { ...value, digest: "sha256:" + "0".repeat(64) });
      await expect(recoverSchema5Migration(root)).rejects.toThrow(
        target === "policy" ? "Unrecognized key" : "body digest",
      );
      expect(await json(join(root, ".empirical", "config.json"))).toMatchObject({ schemaVersion: 4 });
    }
  });
});
