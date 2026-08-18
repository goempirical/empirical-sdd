import { createHash } from "node:crypto";

import { z } from "zod";

export const SCHEMA_VERSION = 5 as const;
export const POLICY_SCHEMA_VERSION = 2 as const;
export const MANIFEST_SCHEMA_VERSION = 2 as const;
export const RECEIPT_SCHEMA_VERSION = 1 as const;
export const PRODUCT_VERSION = "0.24.0";

export const workflowSchema = z.enum(["fast", "complex"]);
export const executionModeSchema = z.enum(["normal", "yolo"]);
export const riskFloorSchema = z.enum([
  "contract-neutral",
  "behavioral",
  "sensitive",
  "migration",
  "integration",
  "delivery",
  "publication",
]);
export const completionLevelSchema = z.enum([
  "none",
  "implemented",
  "verified",
  "integrated",
  "delivered",
  "published",
]);
export const phaseSchema = z.enum([
  "idle",
  "shape",
  "specify",
  "design",
  "plan",
  "implement",
  "context",
  "verify",
  "review",
  "integrate",
  "deliver",
  "publish",
  "archive",
  "done",
]);
export const workflowStatusSchema = z.enum([
  "idle",
  "waiting",
  "awaiting_human",
  "blocked",
  "done",
]);

export type Workflow = z.infer<typeof workflowSchema>;
export type ExecutionMode = z.infer<typeof executionModeSchema>;
export type RiskFloor = z.infer<typeof riskFloorSchema>;
export type CompletionLevel = z.infer<typeof completionLevelSchema>;
export type Phase = z.infer<typeof phaseSchema>;
export type WorkflowStatus = z.infer<typeof workflowStatusSchema>;

type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

function normalizeJson(value: unknown, seen: Set<object>): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON cannot contain non-finite numbers.");
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new TypeError("Canonical JSON cannot contain cycles.");
    }
    seen.add(value);
    const result = value.map((entry) => normalizeJson(entry, seen));
    seen.delete(value);
    return result;
  }
  if (typeof value === "object") {
    if (seen.has(value)) {
      throw new TypeError("Canonical JSON cannot contain cycles.");
    }
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Canonical JSON accepts only plain objects.");
    }
    seen.add(value);
    const result: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry === undefined) {
        throw new TypeError(`Canonical JSON cannot contain undefined at ${key}.`);
      }
      result[key] = normalizeJson(entry, seen);
    }
    seen.delete(value);
    return result;
  }
  throw new TypeError(`Canonical JSON cannot contain ${typeof value}.`);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeJson(value, new Set<object>()));
}

export function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function digestJson(value: unknown): string {
  return sha256(canonicalJson(value));
}

export const criterionSchema = z
  .object({
    id: z.string().regex(/^AC-[A-Z0-9]+(?:-[A-Z0-9]+)*$/),
    text: z.string().trim().min(1),
    ui: z.boolean().default(false),
    checked: z.boolean().default(false),
  })
  .strict();

export type Criterion = z.infer<typeof criterionSchema>;

export const evidenceKindSchema = z.enum([
  "test",
  "browser",
  "screenshot",
  "review",
  "human",
]);

export function validateCriteria(criteria: readonly Criterion[]): void {
  const ids = new Set<string>();
  for (const input of criteria) {
    const criterion = criterionSchema.parse(input);
    if (ids.has(criterion.id)) {
      throw new Error(`Duplicate acceptance criterion id: ${criterion.id}`);
    }
    ids.add(criterion.id);
  }
}

export const commandPolicySchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    argv: z.array(z.string().min(1)).min(1),
    cwd: z.string().min(1).default("."),
    timeoutMs: z.number().int().positive().max(900_000),
    maxOutputBytes: z.number().int().positive().max(4_194_304).default(262_144),
    evidenceKinds: z.array(evidenceKindSchema).min(1).default(["test"]),
    criteria: z
      .array(z.string().regex(/^AC-[A-Z0-9]+(?:-[A-Z0-9]+)*$/))
      .default([]),
  })
  .strict();

export type CommandPolicy = z.infer<typeof commandPolicySchema>;

export const evidencePolicySchema = z
  .object({
    required: z.boolean().default(true),
    browserForUi: z.boolean().default(true),
    screenshotForUi: z.boolean().default(true),
    codeReview: z.boolean().default(true),
  })
  .strict();

export const projectPolicySchema = z
  .object({
    schemaVersion: z.literal(POLICY_SCHEMA_VERSION),
    context: z.array(z.string().trim().min(1)).default([]),
    phases: z
      .partialRecord(phaseSchema, z.array(z.string().trim().min(1)))
      .default(() => ({})),
    verification: z
      .object({
        evidence: evidencePolicySchema.default(() => ({
          required: true,
          browserForUi: true,
          screenshotForUi: true,
          codeReview: true,
        })),
        commands: z.array(commandPolicySchema).default([]),
      })
      .strict()
      .default(() => ({
        evidence: {
          required: true,
          browserForUi: true,
          screenshotForUi: true,
          codeReview: true,
        },
        commands: [],
      })),
    delivery: z
      .object({
        provider: z.literal("github"),
        targetBranch: z.string().regex(/^(?!-)(?!.*\.\.)(?!.*[~^:?*\[\\])[^\s]+$/),
        requiredChecks: z.array(z.string().trim().min(1)).default([]),
      })
      .strict()
      .nullable()
      .default(null),
    preferredAgent: z
      .enum(["codex", "claude", "cursor", "gemini", "windsurf"])
      .nullable()
      .default(null),
  })
  .strict();

export type EvidencePolicy = z.infer<typeof evidencePolicySchema>;
export type ProjectPolicy = z.infer<typeof projectPolicySchema>;

export const impactManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    classification: z.enum(["behavioral", "non-behavioral"]),
    capabilities: z.array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)),
    surfaces: z.array(z.string().trim().min(1)).min(1),
    regressionRationale: z.string().trim().min(1).nullable(),
    digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  })
  .strict();

export type ImpactManifest = z.infer<typeof impactManifestSchema>;

export function createImpactManifest(
  input: Omit<ImpactManifest, "digest">,
): ImpactManifest {
  const normalized = {
    ...input,
    capabilities: [...new Set(input.capabilities)].sort(),
    surfaces: [...new Set(input.surfaces)].sort(),
  };
  if (normalized.classification === "behavioral") {
    if (normalized.capabilities.length === 0) {
      throw new Error("Behavioral Complex work must name affected capabilities.");
    }
    if (normalized.regressionRationale !== null) {
      throw new Error("Behavioral impact must not use a non-behavioral rationale.");
    }
  } else {
    if (normalized.capabilities.length > 0) {
      throw new Error("Non-behavioral work must not claim capability deltas.");
    }
    if (!normalized.regressionRationale?.trim()) {
      throw new Error("Non-behavioral work needs a regression rationale.");
    }
  }
  return impactManifestSchema.parse({
    ...normalized,
    digest: digestJson(normalized),
  });
}

export function verifyImpactManifest(manifest: ImpactManifest): void {
  const parsed = impactManifestSchema.parse(manifest);
  const { digest, ...body } = parsed;
  if (digestJson(body) !== digest) {
    throw new Error("Impact manifest digest does not match its contents.");
  }
  createImpactManifest(body);
}

export const authorizationSchema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.literal("yolo"),
    repositoryId: z.string().min(1),
    feature: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    requestDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    ceiling: z.enum(["implemented", "verified", "integrated", "delivered", "published"]),
    targetBranch: z.string().min(1).nullable(),
    allowExternalAgent: z.boolean(),
    createdAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }).nullable(),
    digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  })
  .strict();

export type StandingAuthorization = z.infer<typeof authorizationSchema>;

export function createAuthorization(
  input: Omit<StandingAuthorization, "schemaVersion" | "mode" | "digest">,
): StandingAuthorization {
  const body = {
    schemaVersion: 1 as const,
    mode: "yolo" as const,
    ...input,
  };
  return authorizationSchema.parse({ ...body, digest: digestJson(body) });
}

export function verifyAuthorization(
  authorization: StandingAuthorization,
  now = new Date(),
): void {
  const parsed = authorizationSchema.parse(authorization);
  const { digest, ...body } = parsed;
  if (digestJson(body) !== digest) {
    throw new Error("Standing authorization digest does not match its contents.");
  }
  if (parsed.expiresAt !== null && Date.parse(parsed.expiresAt) <= now.getTime()) {
    throw new Error("Standing authorization has expired.");
  }
}

export interface CompletionFacts {
  implemented: boolean;
  verified: boolean;
  integrated: boolean;
  delivered: boolean;
  published: boolean;
}

export interface CompletionReport extends CompletionFacts {
  highest: CompletionLevel;
  reasons: Partial<Record<Exclude<CompletionLevel, "none">, string>>;
}

const COMPLETION_ORDER = [
  "implemented",
  "verified",
  "integrated",
  "delivered",
  "published",
] as const;

export function deriveCompletion(facts: CompletionFacts): CompletionReport {
  let prior = true;
  let highest: CompletionLevel = "none";
  const reasons: CompletionReport["reasons"] = {};
  for (const level of COMPLETION_ORDER) {
    if (facts[level] && !prior) {
      throw new Error(`Completion fact ${level} cannot precede its prerequisite.`);
    }
    if (facts[level]) {
      highest = level;
    } else {
      prior = false;
      reasons[level] = `${level} has not been proven by a durable receipt.`;
    }
  }
  return { ...facts, highest, reasons };
}

export const receiptProvenanceSchema = z
  .object({
    repositoryId: z.string().min(1),
    feature: z.string().min(1),
    specRevision: z.number().int().positive(),
    specDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    treeDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    policyDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  })
  .strict();

const receiptBaseSchema = z.object({
  schemaVersion: z.literal(RECEIPT_SCHEMA_VERSION),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{7,127}$/),
  criteria: z.array(z.string().regex(/^AC-[A-Z0-9]+(?:-[A-Z0-9]+)*$/)).min(1),
  evidenceKinds: z
    .array(evidenceKindSchema)
    .min(1),
  summary: z.string().trim().min(1),
  passed: z.boolean(),
  startedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }),
  provenance: receiptProvenanceSchema,
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});

export const executedReceiptSchema = receiptBaseSchema
  .extend({
    kind: z.literal("executed"),
    command: z
      .object({
        argv: z.array(z.string().min(1)).min(1),
        cwd: z.string().min(1),
        timeoutMs: z.number().int().positive(),
        maxOutputBytes: z.number().int().positive(),
        environmentKeys: z.array(z.string()).default([]),
      })
      .strict(),
    result: z
      .object({
        exitCode: z.number().int().nullable(),
        signal: z.string().nullable(),
        timedOut: z.boolean(),
        stdoutDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
        stderrDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
        stdoutTail: z.string(),
        stderrTail: z.string(),
        stdoutTruncated: z.boolean(),
        stderrTruncated: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const artifactRecordSchema = z
  .object({
    path: z.string().min(1),
    mediaType: z.string().min(1),
    bytes: z.number().int().nonnegative(),
    digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  })
  .strict();

export const collectedReceiptSchema = receiptBaseSchema
  .extend({
    kind: z.literal("collected"),
    collector: z.string().trim().min(1),
    artifacts: z.array(artifactRecordSchema).min(1),
  })
  .strict();

export const evidenceReceiptSchema = z.discriminatedUnion("kind", [
  executedReceiptSchema,
  collectedReceiptSchema,
]);

export type ExecutedReceipt = z.infer<typeof executedReceiptSchema>;
export type CollectedReceipt = z.infer<typeof collectedReceiptSchema>;
export type EvidenceReceipt = z.infer<typeof evidenceReceiptSchema>;

export function verifyReceiptDigest(receipt: EvidenceReceipt): void {
  const parsed = evidenceReceiptSchema.parse(receipt);
  const { digest, ...body } = parsed;
  if (digestJson(body) !== digest) {
    throw new Error(`Evidence receipt ${parsed.id} failed its digest check.`);
  }
  const { id: _id, ...seed } = body;
  const expectedId = `${parsed.kind}-${digestJson(seed).slice("sha256:".length, "sha256:".length + 24)}`;
  if (parsed.id !== expectedId) {
    throw new Error(`Evidence receipt ${parsed.id} has a non-canonical id.`);
  }
  if (Date.parse(parsed.completedAt) < Date.parse(parsed.startedAt)) {
    throw new Error(`Evidence receipt ${parsed.id} completed before it started.`);
  }
  if (new Set(parsed.criteria).size !== parsed.criteria.length) {
    throw new Error(`Evidence receipt ${parsed.id} repeats acceptance criteria.`);
  }
  if (new Set(parsed.evidenceKinds).size !== parsed.evidenceKinds.length) {
    throw new Error(`Evidence receipt ${parsed.id} repeats evidence kinds.`);
  }
  const expectedPassed = parsed.kind === "collected"
    ? true
    : parsed.result.exitCode === 0
      && parsed.result.signal === null
      && !parsed.result.timedOut;
  if (parsed.passed !== expectedPassed) {
    throw new Error(`Evidence receipt ${parsed.id} has an asserted result inconsistent with its provenance.`);
  }
}
