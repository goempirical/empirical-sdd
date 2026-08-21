import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  appendReceipt,
  createCollectedReceipt,
  createExecutedReceipt,
  repositoryTreeDigest,
  validateReceipt,
  type ReceiptProvenanceInput,
} from "../src/evidence.js";
import { OPERATIONS, SKILLS, assertRegistryIntegrity, operationAnnotations } from "../src/operations.js";
import { defaultPolicy, effectivePolicy, migratePolicyV1, parsePolicy } from "../src/policy.js";
import {
  POLICY_SCHEMA_VERSION,
  PRODUCT_VERSION,
  SCHEMA_VERSION,
  canonicalJson,
  createAuthorization,
  createImpactManifest,
  deriveCompletion,
  digestJson,
  sha256,
  validateCriteria,
  verifyAuthorization,
  verifyImpactManifest,
  verifyReceiptDigest,
  type Criterion,
  type EvidenceReceipt,
} from "../src/protocol.js";
import { isBlockingProductQuestion, routeRequest } from "../src/routing.js";
import { executeCommand, redactOutput, type ProcessAdapter, type RuntimeResult } from "../src/runtime.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "empirical-trust-"));
  directories.push(root);
  return root;
}

const provenance: ReceiptProvenanceInput = {
  repositoryId: "repo-1",
  feature: "trust-overhaul",
  specRevision: 4,
  specDigest: sha256("spec"),
  treeDigest: sha256("tree"),
  policyDigest: sha256("policy"),
};

const criteria: Criterion[] = [
  { id: "AC-1", text: "The command succeeds.", ui: false, checked: false },
  { id: "AC-2", text: "The artifact is intact.", ui: false, checked: false },
];

function validation(root: string) {
  return {
    root,
    repositoryId: provenance.repositoryId,
    feature: provenance.feature,
    criteria,
    specRevision: provenance.specRevision,
    specDigest: provenance.specDigest,
    treeDigest: provenance.treeDigest,
    policyDigest: provenance.policyDigest,
  };
}

describe("Schema-5 protocol", () => {
  test("exports one coherent alpha protocol version", () => {
    expect(SCHEMA_VERSION).toBe(5);
    expect(POLICY_SCHEMA_VERSION).toBe(2);
    expect(PRODUCT_VERSION).toBe("0.26.1");
  });

  test("canonical JSON is key-order independent and rejects unsafe values", () => {
    expect(canonicalJson({ z: [2, { b: true, a: null }], a: -0 })).toBe(
      '{"a":0,"z":[2,{"a":null,"b":true}]}',
    );
    expect(digestJson({ b: 2, a: 1 })).toBe(digestJson({ a: 1, b: 2 }));
    expect(() => canonicalJson({ bad: Number.NaN })).toThrow("non-finite");
    expect(() => canonicalJson({ missing: undefined })).toThrow("undefined");
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow("cycles");
    expect(() => canonicalJson(new Date())).toThrow("plain objects");
  });

  test("criteria require stable unique identifiers", () => {
    validateCriteria(criteria);
    expect(() =>
      validateCriteria([criteria[0]!, { ...criteria[0]!, text: "Duplicate" }]),
    ).toThrow("Duplicate acceptance criterion");
    expect(() =>
      validateCriteria([{ id: "one", text: "Invalid", ui: false, checked: false }]),
    ).toThrow();
  });

  test("impact manifests enforce behavioral and non-behavioral contracts", () => {
    const behavioral = createImpactManifest({
      schemaVersion: 1,
      classification: "behavioral",
      capabilities: ["workflow-routing", "workflow-routing"],
      surfaces: ["MCP", "CLI"],
      regressionRationale: null,
    });
    expect(behavioral.capabilities).toEqual(["workflow-routing"]);
    expect(() => verifyImpactManifest(behavioral)).not.toThrow();
    expect(() =>
      createImpactManifest({
        schemaVersion: 1,
        classification: "behavioral",
        capabilities: [],
        surfaces: ["core"],
        regressionRationale: null,
      }),
    ).toThrow("must name affected capabilities");
    const internal = createImpactManifest({
      schemaVersion: 1,
      classification: "non-behavioral",
      capabilities: [],
      surfaces: ["runtime internals"],
      regressionRationale: "Public behavior is fixed by the regression suite.",
    });
    expect(() => verifyImpactManifest(internal)).not.toThrow();
    expect(() =>
      verifyImpactManifest({ ...behavioral, surfaces: ["edited"] }),
    ).toThrow("digest");
  });

  test("standing authorization is digest-bound, bounded, and expires", () => {
    const authorization = createAuthorization({
      repositoryId: "repo-1",
      feature: "trust-overhaul",
      requestDigest: sha256("request"),
      ceiling: "integrated",
      targetBranch: null,
      allowExternalAgent: false,
      createdAt: "2026-08-03T12:00:00.000Z",
      expiresAt: "2026-08-04T12:00:00.000Z",
    });
    expect(() => verifyAuthorization(authorization, new Date("2026-08-03T13:00:00Z"))).not.toThrow();
    expect(() =>
      verifyAuthorization({ ...authorization, ceiling: "published" }),
    ).toThrow("digest");
    expect(() =>
      verifyAuthorization(authorization, new Date("2026-08-05T00:00:00Z")),
    ).toThrow("expired");
  });

  test("completion cannot skip a durable level", () => {
    expect(
      deriveCompletion({
        implemented: true,
        verified: true,
        integrated: false,
        delivered: false,
        published: false,
      }),
    ).toMatchObject({ highest: "verified", integrated: false });
    expect(() =>
      deriveCompletion({
        implemented: true,
        verified: false,
        integrated: true,
        delivered: false,
        published: false,
      }),
    ).toThrow("cannot precede");
  });
});

describe("operation and skill registry", () => {
  test("has unique operations and exactly one registry-backed skill", () => {
    expect(() => assertRegistryIntegrity()).not.toThrow();
    expect(SKILLS.map((skill) => skill.id)).toEqual(["empirical-init"]);
    expect(new Set(OPERATIONS.map((entry) => entry.mcpName)).size).toBe(
      OPERATIONS.length,
    );
    expect(operationAnnotations("doctor")).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    });
    expect(operationAnnotations("publish")).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    });
    expect(operationAnnotations("tracker-bind")).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    });
    expect(operationAnnotations("tracker-configure")).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    });
    expect(operationAnnotations("tracker-sync")).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    });
    expect(OPERATIONS.filter((entry) => entry.readOnly && entry.destructive)).toEqual([]);
  });
});

describe("deterministic routing", () => {
  test("keeps explicit neutral edits Fast and promotes every material floor", () => {
    expect(routeRequest({ request: "Fix a docs punctuation typo" })).toMatchObject({
      profile: "fast",
      riskFloor: "contract-neutral",
    });
    expect(
      routeRequest({
        request: "Migrate persisted state to schema 5",
        requestedProfile: "fast",
      }),
    ).toMatchObject({
      profile: "complex",
      riskFloor: "migration",
      promoted: true,
    });
    expect(routeRequest({ request: "Publish npm release 1.0.0" })).toMatchObject({
      riskFloor: "publication",
      profile: "complex",
    });
    expect(routeRequest({ request: "A vague but non-empty idea" })).toMatchObject({
      riskFloor: "behavioral",
      profile: "complex",
    });
  });

  test("normal retains material gates and YOLO retains external safety gates", () => {
    const normal = routeRequest({ request: "Push a GitHub pull request", mode: "normal" });
    const yolo = routeRequest({ request: "Push a GitHub pull request", mode: "yolo" });
    expect(normal.gates).toContain("implementation");
    expect(normal.gates).toContain("delivery-authorization");
    expect(yolo.gates).not.toContain("implementation");
    expect(yolo.gates).toContain("delivery-authorization");
    expect(yolo.gates).toContain("host-permissions");
    expect(routeRequest({ request: "Push a GitHub pull request", mode: "yolo" })).toEqual(yolo);
  });

  test("YOLO questions only when material outcomes cannot be resolved", () => {
    expect(
      isBlockingProductQuestion({
        materiallyDifferentOutcomes: ["local only", "deliver to GitHub"],
        repositoryResolves: false,
        policyResolves: false,
        priorDecisionResolves: false,
        safeDefaultResolves: false,
      }),
    ).toBe(true);
    expect(
      isBlockingProductQuestion({
        materiallyDifferentOutcomes: ["one", "two"],
        repositoryResolves: true,
        policyResolves: false,
        priorDecisionResolves: false,
        safeDefaultResolves: false,
      }),
    ).toBe(false);
  });
});

describe("Policy v2", () => {
  test("strict defaults grant no delivery or publication authority", async () => {
    const root = await temporaryRoot();
    expect(defaultPolicy()).toMatchObject({
      schemaVersion: 2,
      delivery: null,
      preferredAgent: null,
      verification: {
        evidence: {
          required: true,
          browserForUi: true,
          screenshotForUi: true,
          codeReview: true,
        },
        commands: [],
      },
    });
    const effective = effectivePolicy(defaultPolicy(), root);
    expect(effective.digest).toBe(digestJson(effective.policy));
  });

  test("accepts exact command vectors and rejects shell/path/timeout hazards", async () => {
    const root = await temporaryRoot();
    const policy = {
      ...defaultPolicy(),
      verification: {
        evidence: defaultPolicy().verification.evidence,
        commands: [
          {
            id: "test",
            argv: ["bun", "test"],
            cwd: ".",
            timeoutMs: 30_000,
            maxOutputBytes: 4096,
            criteria: ["AC-1"],
          },
        ],
      },
    };
    expect(parsePolicy(policy, root).verification.commands[0]?.argv).toEqual([
      "bun",
      "test",
    ]);
    expect(() =>
      parsePolicy(
        {
          ...policy,
          verification: {
            ...policy.verification,
            commands: [{ ...policy.verification.commands[0]!, argv: ["sh", "-c", "test | tee out"] }],
          },
        },
        root,
      ),
    ).toThrow("may not invoke a shell");
    expect(() =>
      parsePolicy(
        {
          ...policy,
          verification: {
            ...policy.verification,
            commands: [{ ...policy.verification.commands[0]!, cwd: "../outside" }],
          },
        },
        root,
      ),
    ).toThrow("escapes the repository");
    const outside = await temporaryRoot();
    await symlink(outside, join(root, "linked-cwd"), "junction");
    expect(() =>
      parsePolicy(
        {
          ...policy,
          verification: {
            ...policy.verification,
            commands: [{ ...policy.verification.commands[0]!, cwd: "linked-cwd" }],
          },
        },
        root,
      ),
    ).toThrow("resolves outside the repository");
    expect(() =>
      parsePolicy(
        {
          ...policy,
          verification: {
            ...policy.verification,
            commands: [{ ...policy.verification.commands[0]!, timeoutMs: 999_999_999 }],
          },
        },
        root,
      ),
    ).toThrow();
  });

  test("migrates v1 guidance without inventing authority", () => {
    expect(
      migratePolicyV1({
        schemaVersion: 1,
        context: ["Keep this local"],
        phases: { implement: ["Run focused tests"] },
      }),
    ).toMatchObject({
      schemaVersion: 2,
      context: ["Keep this local"],
      delivery: null,
      preferredAgent: null,
    });
    expect(() => migratePolicyV1({ schemaVersion: 7 })).toThrow("Schema-1");
  });
});

describe("shell-free runtime", () => {
  test("passes exact argv/cwd and stores no environment values", async () => {
    const root = await temporaryRoot();
    let invocation: Parameters<ProcessAdapter>[0] | undefined;
    const adapter: ProcessAdapter = async (received) => {
      invocation = received;
      return {
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: Buffer.from("ok ghp_abcdefghijklmnopqrstuvwxyz123456"),
        stderr: Buffer.from(""),
        stdoutTruncated: false,
        stderrTruncated: false,
      };
    };
    const times = [new Date("2026-08-03T10:00:00Z"), new Date("2026-08-03T10:00:01Z")];
    const result = await executeCommand(
      root,
      {
        argv: ["git", "status", "--short"],
        cwd: ".",
        timeoutMs: 10_000,
        maxOutputBytes: 1024,
        environment: { EMPIRICAL_MODE: "test" },
      },
      adapter,
      () => times.shift()!,
    );
    expect(invocation).toMatchObject({
      executable: "git",
      args: ["status", "--short"],
      cwd: await realpath(root),
    });
    expect(result.stdoutTail).toBe("ok [REDACTED]");
    expect(result.stdoutDigest).toBe(sha256("ok [REDACTED]"));
    expect(result.environmentKeys).toContain("EMPIRICAL_MODE");
    expect(JSON.stringify(result)).not.toContain("test");
    expect(result).toMatchObject({ exitCode: 0, timedOut: false, cwd: "." });
  });

  test("rejects path escapes, bounds, null argv, and secret-like environment keys", async () => {
    const root = await temporaryRoot();
    const adapter: ProcessAdapter = async () => {
      throw new Error("adapter must not run");
    };
    await expect(
      executeCommand(root, { argv: ["git"], cwd: "../outside", timeoutMs: 1, maxOutputBytes: 1 }, adapter),
    ).rejects.toThrow("escapes the repository");
    await expect(
      executeCommand(root, { argv: ["git\0bad"], cwd: ".", timeoutMs: 1, maxOutputBytes: 1 }, adapter),
    ).rejects.toThrow("null-free");
    await expect(
      executeCommand(root, { argv: ["git"], cwd: ".", timeoutMs: 0, maxOutputBytes: 1 }, adapter),
    ).rejects.toThrow("timeout");
    await expect(
      executeCommand(
        root,
        { argv: ["git"], cwd: ".", timeoutMs: 1, maxOutputBytes: 1, environment: { API_TOKEN: "hidden" } },
        adapter,
      ),
    ).rejects.toThrow("secret-like");
    expect(redactOutput("Bearer abc.def ghp_abcdefghijklmnopqrstuvwxyz123456")).toBe(
      "[REDACTED] [REDACTED]",
    );
  });
});

describe("immutable evidence receipts", () => {
  test("repository tree digests exclude reserved migration scratch only", async () => {
    const root = await temporaryRoot();
    await writeFile(join(root, "source.txt"), "source\n", "utf8");
    const initial = await repositoryTreeDigest(root);
    const stage = join(root, ".empirical.schema5-stage-aborted");
    const reserved = join(root, ".empirical.schema5-aborted-metadata");
    const backup = join(root, ".empirical.schema4-backup-aborted");
    await mkdir(stage);
    await mkdir(reserved);
    await mkdir(backup);
    await writeFile(join(root, ".empirical.schema5-migration.json"), "{}\n", "utf8");
    await writeFile(join(stage, "duplicate.ts"), "stale stage\n", "utf8");
    await writeFile(join(reserved, "transaction.json"), "stale metadata\n", "utf8");
    await writeFile(join(backup, "duplicate.ts"), "stale backup\n", "utf8");
    expect(await repositoryTreeDigest(root)).toBe(initial);
    const nested = join(root, "ordinary", ".empirical.schema5-user");
    await mkdir(nested, { recursive: true });
    await writeFile(join(nested, "source.ts"), "nested ordinary source\n", "utf8");
    const nestedDigest = await repositoryTreeDigest(root);
    expect(nestedDigest).not.toBe(initial);
    await writeFile(join(root, "ordinary.ts"), "ordinary source\n", "utf8");
    expect(await repositoryTreeDigest(root)).not.toBe(nestedDigest);
  });

  test("derives executed pass/fail from runtime and validates provenance", async () => {
    const root = await temporaryRoot();
    const result: RuntimeResult = {
      argv: ["bun", "test"],
      cwd: ".",
      timeoutMs: 30_000,
      maxOutputBytes: 1024,
      environmentKeys: ["PATH"],
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdoutDigest: sha256("pass"),
      stderrDigest: sha256(""),
      stdoutTail: "pass",
      stderrTail: "",
      stdoutTruncated: false,
      stderrTruncated: false,
      startedAt: "2026-08-03T10:00:00.000Z",
      completedAt: "2026-08-03T10:00:01.000Z",
    };
    const receipt = createExecutedReceipt({
      criteria: ["AC-1"],
      summary: "Focused command passed.",
      provenance,
      result,
    });
    expect(receipt.passed).toBe(true);
    expect(await validateReceipt(receipt, validation(root))).toEqual(receipt);
    await expect(
      validateReceipt(receipt, { ...validation(root), repositoryId: "another-repository" }),
    ).rejects.toThrow("another repository");
    await expect(
      validateReceipt(receipt, { ...validation(root), feature: "another-feature" }),
    ).rejects.toThrow("another feature");
    expect(() => verifyReceiptDigest({ ...receipt, passed: false })).toThrow("digest");
    const { id: _id, digest: _digest, ...forgedSeed } = { ...receipt, passed: false };
    const forgedId = `executed-${digestJson(forgedSeed).slice("sha256:".length, "sha256:".length + 24)}`;
    const forgedBody = { ...forgedSeed, id: forgedId };
    const forged = { ...forgedBody, digest: digestJson(forgedBody) };
    expect(() => verifyReceiptDigest(forged)).toThrow("asserted result");
    await expect(
      validateReceipt(receipt, { ...validation(root), treeDigest: sha256("new tree") }),
    ).rejects.toThrow("stale tree");
    await expect(
      validateReceipt({ ...receipt, criteria: ["AC-999"] }, validation(root)),
    ).rejects.toThrow();
    expect(
      createExecutedReceipt({
        criteria: ["AC-1"],
        summary: "Command failed.",
        provenance,
        result: { ...result, exitCode: 1 },
      }).passed,
    ).toBe(false);
  });

  test("hashes collected artifacts and rejects modification or escape", async () => {
    const root = await temporaryRoot();
    await writeFile(join(root, "artifact.txt"), "original\n", "utf8");
    const receipt = await createCollectedReceipt({
      root,
      criteria: ["AC-2"],
      summary: "Artifact collected.",
      collector: "codex",
      provenance,
      artifacts: [{ path: "artifact.txt", mediaType: "text/plain" }],
      now: () => new Date("2026-08-03T10:00:00Z"),
    });
    expect(await validateReceipt(receipt, validation(root))).toEqual(receipt);
    await writeFile(join(root, "artifact.txt"), "modified\n", "utf8");
    await expect(validateReceipt(receipt, validation(root))).rejects.toThrow(
      "artifact was modified",
    );
    await expect(
      createCollectedReceipt({
        root,
        criteria: ["AC-2"],
        summary: "Escape",
        collector: "codex",
        provenance,
        artifacts: [{ path: "../outside", mediaType: "text/plain" }],
      }),
    ).rejects.toThrow("escapes the repository");
    const outside = await temporaryRoot();
    await writeFile(join(outside, "secret.txt"), "must not be read\n", "utf8");
    await symlink(join(outside, "secret.txt"), join(root, "linked-artifact.txt"));
    await expect(
      createCollectedReceipt({
        root,
        criteria: ["AC-2"],
        summary: "Linked escape",
        collector: "codex",
        provenance,
        artifacts: [{ path: "linked-artifact.txt", mediaType: "text/plain" }],
      }),
    ).rejects.toThrow("non-symbolic");
  });

  test("exclusive append preserves an immutable receipt file", async () => {
    const root = await temporaryRoot();
    const directory = join(root, "receipts");
    await mkdir(directory);
    const receipt = createExecutedReceipt({
      criteria: ["AC-1"],
      summary: "Focused command passed.",
      provenance,
      result: {
        argv: ["true"],
        cwd: ".",
        timeoutMs: 100,
        maxOutputBytes: 100,
        environmentKeys: [],
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdoutDigest: sha256(""),
        stderrDigest: sha256(""),
        stdoutTail: "",
        stderrTail: "",
        stdoutTruncated: false,
        stderrTruncated: false,
        startedAt: "2026-08-03T10:00:00.000Z",
        completedAt: "2026-08-03T10:00:00.001Z",
      },
    });
    const path = join(directory, `${receipt.id}.json`);
    await appendReceipt(path, receipt);
    await expect(appendReceipt(path, receipt)).rejects.toMatchObject({ code: "EEXIST" });
    expect(JSON.parse(await readFile(path, "utf8")) as EvidenceReceipt).toEqual(receipt);
  });
});
