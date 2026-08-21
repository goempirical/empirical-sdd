import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import { z } from "zod";

import { EmpiricalError } from "./errors.js";
import { inferChangeType } from "./worktrees.js";
import { resolveTrackerAuthentication } from "./tracker-auth.js";
import {
  digestJson,
  evidenceReceiptSchema,
  sha256,
  verifyReceiptDigest,
  type EvidenceReceipt,
} from "./protocol.js";
import {
  ProjectStore,
  isFile,
  isSymbolicLink,
  readJson,
  withOwnedFileLock,
  writeJsonAtomic,
} from "./storage.js";
import type {
  JiraTrackerPolicy,
  LinearTrackerPolicy,
  GitHubTrackerPolicy,
  TrackerBindInput,
  TrackerBindIntent,
  TrackerBindResult,
  TrackerBinding,
  TrackerArtifact,
  TrackerDiscovery,
  TrackerDiscoveryInput,
  TrackerDiscoveryResource,
  TrackerMappingCandidate,
  TrackerMappingSuggestion,
  TrackerDependencies,
  EffectiveTrackerPolicy,
  TrackerFailure,
  TrackerHttpRequest,
  TrackerHttpResponse,
  TrackerPendingRecord,
  TrackerPolicy,
  TrackerPolicyPreview,
  TrackerProgressState,
  TrackerProgressVisibility,
  TrackerProjection,
  TrackerProvider,
  ResolvedTrackerAuthentication,
  TrackerStateMap,
  TrackerStatus,
  TrackerSetupChange,
  TrackerSyncResult,
  TrackerTicketPolicy,
  TrackerTicketRequirement,
  TrackerTicketResolution,
  TrackerTicketRules,
  TrackerTransport,
  WorkflowState,
} from "./types.js";

export const TRACKER_SCHEMA_VERSION = 2 as const;
export const TRACKER_LEGACY_SCHEMA_VERSION = 1 as const;
export const DISABLED_TRACKER_SETUP = { schemaVersion: 1, mode: "disabled" } as const;
const TRACKER_TIMEOUT_MS = 30_000;
const TRACKER_MAX_RESPONSE_BYTES = 1_048_576;
const TRACKER_ERROR_LIMIT = 500;
const ENVIRONMENT_NAME = /^(?=.{2,64}$)[A-Z][A-Z0-9]*_[A-Z0-9_]+$/;
const REMOTE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:+\/=\-]{0,255}$/;
const PROJECT_KEY = /^[A-Z][A-Z0-9_]{0,31}$/;
const TRACKER_PROGRESS_STATES: TrackerProgressState[] = [
  "specification",
  "planned",
  "in-progress",
  "verification",
  "review",
  "blocked",
  "done",
];
const TRACKER_DISCOVERY_LIMIT = 100;
// Linear multiplies nested connection sizes into the query complexity score.
// Ten teams keeps the two 100-item nested connections below its 10,000 limit.
const LINEAR_TEAM_DISCOVERY_PAGE_SIZE = 10;
const TRACKER_ARTIFACT_MAX_COUNT = 10;
const TRACKER_ARTIFACT_MAX_BYTES = 5 * 1_024 * 1_024;
const TRACKER_ARTIFACT_TOTAL_BYTES = 10 * 1_024 * 1_024;
const TRACKER_ARTIFACT_MEDIA = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "application/json",
  "text/plain",
  "text/markdown",
]);

const trackerStateMapSchema = z.object({
  specification: z.string().trim().min(1).max(256),
  planned: z.string().trim().min(1).max(256),
  "in-progress": z.string().trim().min(1).max(256),
  verification: z.string().trim().min(1).max(256),
  review: z.string().trim().min(1).max(256),
  blocked: z.string().trim().min(1).max(256),
  done: z.string().trim().min(1).max(256),
}).strict();

const environmentNameSchema = z.string().regex(ENVIRONMENT_NAME);
const remoteIdSchema = z.string().regex(REMOTE_ID);
const trackerTicketPolicySchema = z.enum(["off", "manual", "ensure"]);
const trackerVisibilitySchema = z.enum(["blockers-final", "milestones", "revisions"]);
const trackerTicketRequirementSchema = z.enum(["required", "optional", "off"]);
const trackerTicketProfileRulesSchema = z.object({
  fast: trackerTicketRequirementSchema,
  quick: trackerTicketRequirementSchema,
  complex: trackerTicketRequirementSchema,
}).strict();
const trackerTicketRulesSchema = z.object({
  feature: trackerTicketProfileRulesSchema,
  fix: trackerTicketProfileRulesSchema,
  chore: trackerTicketProfileRulesSchema,
}).strict();

const githubTrackerPolicyV1Schema = z.object({
  schemaVersion: z.literal(TRACKER_LEGACY_SCHEMA_VERSION),
  provider: z.literal("github"),
  target: z.object({
    owner: z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/),
    repository: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/),
    projectId: remoteIdSchema,
    statusFieldId: remoteIdSchema,
  }).strict(),
  credentialEnv: z.object({ token: environmentNameSchema }).strict(),
  states: trackerStateMapSchema,
}).strict();

const githubTrackerPolicyV2Schema = z.object({
  schemaVersion: z.literal(TRACKER_SCHEMA_VERSION),
  provider: z.literal("github"),
  target: z.object({
    owner: z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/),
    repository: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/),
    projectId: remoteIdSchema,
    statusFieldId: remoteIdSchema,
  }).strict(),
  credentialEnv: z.object({ token: environmentNameSchema }).strict(),
  states: trackerStateMapSchema,
  ticket: trackerTicketPolicySchema,
  visibility: trackerVisibilitySchema,
  ticketRules: trackerTicketRulesSchema.optional(),
}).strict();

const linearTrackerPolicyV1Schema = z.object({
  schemaVersion: z.literal(TRACKER_LEGACY_SCHEMA_VERSION),
  provider: z.literal("linear"),
  target: z.object({
    teamId: remoteIdSchema,
    projectId: remoteIdSchema.nullable(),
  }).strict(),
  credentialEnv: z.object({ apiKey: environmentNameSchema }).strict(),
  states: trackerStateMapSchema,
}).strict();

const linearTrackerPolicyV2Schema = z.object({
  schemaVersion: z.literal(TRACKER_SCHEMA_VERSION),
  provider: z.literal("linear"),
  target: z.object({
    teamId: remoteIdSchema,
    projectId: remoteIdSchema.nullable(),
  }).strict(),
  credentialEnv: z.object({ apiKey: environmentNameSchema }).strict(),
  states: trackerStateMapSchema,
  ticket: trackerTicketPolicySchema,
  visibility: trackerVisibilitySchema,
  ticketRules: trackerTicketRulesSchema.optional(),
}).strict();

const jiraTrackerPolicyV1Schema = z.object({
  schemaVersion: z.literal(TRACKER_LEGACY_SCHEMA_VERSION),
  provider: z.literal("jira"),
  target: z.object({
    siteUrl: z.string().url().max(2048),
    projectKey: z.string().regex(PROJECT_KEY),
    issueTypeId: remoteIdSchema,
  }).strict(),
  credentialEnv: z.object({
    email: environmentNameSchema,
    apiToken: environmentNameSchema,
  }).strict(),
  states: trackerStateMapSchema,
}).strict();

const jiraTrackerPolicyV2Schema = z.object({
  schemaVersion: z.literal(TRACKER_SCHEMA_VERSION),
  provider: z.literal("jira"),
  target: z.object({
    siteUrl: z.string().url().max(2048),
    projectKey: z.string().regex(PROJECT_KEY),
    issueTypeId: remoteIdSchema,
  }).strict(),
  credentialEnv: z.object({
    email: environmentNameSchema,
    apiToken: environmentNameSchema,
  }).strict(),
  states: trackerStateMapSchema,
  ticket: trackerTicketPolicySchema,
  visibility: trackerVisibilitySchema,
  ticketRules: trackerTicketRulesSchema.optional(),
}).strict();

export const trackerPolicySchema = z.union([
  githubTrackerPolicyV1Schema,
  githubTrackerPolicyV2Schema,
  linearTrackerPolicyV1Schema,
  linearTrackerPolicyV2Schema,
  jiraTrackerPolicyV1Schema,
  jiraTrackerPolicyV2Schema,
]);

export const trackerSetupChangeSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("preserve") }).strict(),
  z.object({ mode: z.literal("disabled") }).strict(),
  z.object({ mode: z.literal("apply"), policy: trackerPolicySchema }).strict(),
]);

const disabledTrackerSetupSchema = z.object({
  schemaVersion: z.literal(1),
  mode: z.literal("disabled"),
}).strict();

export type TrackerSetupState =
  | { mode: "unconfigured"; policy: null }
  | { mode: "disabled"; policy: null }
  | { mode: "configured"; policy: TrackerPolicy };

const trackerProjectionBaseSchema = {
  feature: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  phase: z.enum([
    "idle", "shape", "specify", "design", "plan", "implement", "context",
    "verify", "review", "integrate", "deliver", "publish", "archive", "done",
  ]),
  status: z.enum(["idle", "waiting", "awaiting_human", "blocked", "done"]),
  revision: z.number().int().nonnegative(),
  completionLevel: z.enum(["none", "implemented", "verified", "integrated", "delivered", "published"]),
  progress: z.enum(["specification", "planned", "in-progress", "verification", "review", "blocked", "done"]),
  summary: z.string().max(TRACKER_ERROR_LIMIT).nullable(),
  marker: z.string().regex(/^empirical-sdd:[a-z0-9][a-z0-9-]{0,79}:r\d+$/),
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
};

const trackerArtifactSchema = z.object({
  receiptId: z.string().regex(/^(?:executed|collected)-[a-z0-9-]+$/),
  path: z.string().min(1).max(1_024),
  mediaType: z.string().min(1).max(128),
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  size: z.number().int().nonnegative(),
  url: z.string().url().max(2_048).nullable(),
}).strict();

const trackerProjectionV1Schema = z.object({
  schemaVersion: z.literal(TRACKER_LEGACY_SCHEMA_VERSION),
  ...trackerProjectionBaseSchema,
}).strict();

const trackerProjectionV2Schema = z.object({
  schemaVersion: z.literal(TRACKER_SCHEMA_VERSION),
  ...trackerProjectionBaseSchema,
  blocker: z.string().max(TRACKER_ERROR_LIMIT).nullable(),
  receiptIds: z.array(z.string().regex(/^(?:executed|collected)-[a-z0-9-]+$/)).max(100),
  receiptDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  artifacts: z.array(trackerArtifactSchema).max(20),
}).strict();

const trackerProjectionSchema = z.union([trackerProjectionV1Schema, trackerProjectionV2Schema]);

const trackerFailureSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/),
  summary: z.string().min(1).max(TRACKER_ERROR_LIMIT),
  at: z.string().datetime({ offset: true }),
}).strict();

const trackerBindingBaseSchema = {
  feature: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  provider: z.enum(["github", "linear", "jira"]),
  remoteId: remoteIdSchema,
  remoteKey: remoteIdSchema,
  url: z.string().url().max(2048),
  projectItemId: remoteIdSchema.nullable(),
  markerId: remoteIdSchema.nullable(),
  targetDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  bindIdempotencyKey: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  lastSyncedRevision: z.number().int().nonnegative().nullable(),
  lastSyncedDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable(),
  lastSyncedPolicyDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable(),
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
};

const trackerBindingV1Schema = z.object({
  schemaVersion: z.literal(TRACKER_LEGACY_SCHEMA_VERSION),
  ...trackerBindingBaseSchema,
}).strict();

const trackerBindingV2Schema = z.object({
  schemaVersion: z.literal(TRACKER_SCHEMA_VERSION),
  ...trackerBindingBaseSchema,
  lastSyncedPhase: z.enum([
    "idle", "shape", "specify", "design", "plan", "implement", "context",
    "verify", "review", "integrate", "deliver", "publish", "archive", "done",
  ]).nullable(),
  lastSyncedStatus: z.enum(["idle", "waiting", "awaiting_human", "blocked", "done"]).nullable(),
  lastSyncedCompletionLevel: z.enum(["none", "implemented", "verified", "integrated", "delivered", "published"]).nullable(),
  lastSyncedReceiptDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable(),
}).strict();

const trackerBindingSchema = z.union([trackerBindingV1Schema, trackerBindingV2Schema]);

const trackerCreateIntentSchema = z.object({
  mode: z.literal("create"),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(4_000),
  marker: z.string().regex(/^empirical-sdd-bind:[a-z0-9][a-z0-9-]{0,79}$/),
  dispatched: z.boolean(),
}).strict();

const trackerAttachIntentSchema = z.object({
  mode: z.literal("attach"),
  ticket: remoteIdSchema,
}).strict();

const trackerBindIntentSchema = z.discriminatedUnion("mode", [
  trackerCreateIntentSchema,
  trackerAttachIntentSchema,
]);

const trackerPendingBaseSchema = {
  provider: z.enum(["github", "linear", "jira"]),
  targetDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  policyDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  projection: trackerProjectionSchema,
  intent: trackerBindIntentSchema,
  replacesBindingDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable(),
  idempotencyKey: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  attempts: z.number().int().nonnegative(),
  status: z.enum(["pending", "failed", "synced"]),
  failure: trackerFailureSchema.nullable(),
  updatedAt: z.string().datetime({ offset: true }),
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
};

const trackerEffectSchema = z.object({
  key: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  kind: z.enum(["transition", "comment", "artifact"]),
  remoteId: z.string().min(1).max(2_048).regex(/^[^\0\r\n]+$/).nullable(),
  at: z.string().datetime({ offset: true }),
}).strict();

const trackerPendingV1Schema = z.object({
  schemaVersion: z.literal(TRACKER_LEGACY_SCHEMA_VERSION),
  ...trackerPendingBaseSchema,
  projection: trackerProjectionV1Schema,
}).strict();

const trackerPendingV2Schema = z.object({
  schemaVersion: z.literal(TRACKER_SCHEMA_VERSION),
  ...trackerPendingBaseSchema,
  projection: trackerProjectionV2Schema,
  effects: z.array(trackerEffectSchema).max(100),
}).strict();

const trackerPendingSchema = z.union([trackerPendingV1Schema, trackerPendingV2Schema]);

export const trackerCreateBindInputSchema = z.object({
  mode: z.literal("create"),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().min(1).max(4_000).optional(),
  replace: z.literal(true).optional(),
  confirmCreateRetry: z.literal(true).optional(),
}).strict();

export const trackerAttachBindInputSchema = z.object({
  mode: z.literal("attach"),
  ticket: remoteIdSchema,
  replace: z.literal(true).optional(),
}).strict();

export const trackerBindInputSchema = z.discriminatedUnion("mode", [
  trackerCreateBindInputSchema,
  trackerAttachBindInputSchema,
]);

const githubTrackerDiscoveryInputSchema = z.object({
  provider: z.literal("github"),
  credentialEnv: z.object({ token: environmentNameSchema }).strict(),
}).strict();

const linearTrackerDiscoveryInputSchema = z.object({
  provider: z.literal("linear"),
  credentialEnv: z.object({ apiKey: environmentNameSchema }).strict(),
}).strict();

const jiraTrackerDiscoveryInputSchema = z.object({
  provider: z.literal("jira"),
  target: z.object({ siteUrl: z.string().url().max(2_048) }).strict(),
  credentialEnv: z.object({
    email: environmentNameSchema,
    apiToken: environmentNameSchema,
  }).strict(),
}).strict();

export const trackerDiscoveryInputSchema = z.discriminatedUnion("provider", [
  githubTrackerDiscoveryInputSchema,
  linearTrackerDiscoveryInputSchema,
  jiraTrackerDiscoveryInputSchema,
]);

export const trackerMappingInputSchema = z.object({
  input: trackerDiscoveryInputSchema,
  stateParentId: remoteIdSchema,
}).strict();

export function parseTrackerDiscoveryInput(value: unknown): TrackerDiscoveryInput {
  let parsed: TrackerDiscoveryInput;
  try {
    parsed = trackerDiscoveryInputSchema.parse(value) as TrackerDiscoveryInput;
  } catch (error) {
    throw new EmpiricalError(
      "INVALID_TRACKER_DISCOVERY_INPUT",
      "Tracker discovery must select one provider and credential environment-variable names only",
      error,
    );
  }
  if (parsed.provider === "jira") validateJiraSite(parsed.target.siteUrl);
  if (containsSecretLikeValue(parsed)) {
    throw new EmpiricalError(
      "INVALID_TRACKER_DISCOVERY_INPUT",
      "Tracker discovery contains a secret-like value; pass credential environment-variable names only",
    );
  }
  return parsed;
}

export function parseTrackerBindInput(value: unknown): TrackerBindInput {
  let parsed: TrackerBindInput;
  try {
    parsed = trackerBindInputSchema.parse(value) as TrackerBindInput;
  } catch (error) {
    throw new EmpiricalError(
      "INVALID_TRACKER_BIND_INPUT",
      "Tracker bind input must be a strict create or attach request with only mode-appropriate fields",
      error,
    );
  }
  if (containsSecretLikeValue(parsed)) {
    throw new EmpiricalError(
      "INVALID_TRACKER_BIND_INPUT",
      "Tracker bind input contains a secret-like value; credentials are never valid tool input",
    );
  }
  return parsed;
}

export function parseTrackerPolicy(value: unknown): TrackerPolicy {
  let parsed: TrackerPolicy;
  try {
    parsed = trackerPolicySchema.parse(value) as TrackerPolicy;
  } catch (error) {
    throw new EmpiricalError(
      "INVALID_TRACKER_POLICY",
      "Tracker Policy v1 or v2 must select one provider with a strict secret-free target and complete state mapping",
      error,
    );
  }
  if (parsed.provider === "jira") validateJiraSite(parsed.target.siteUrl);
  if (parsed.schemaVersion === TRACKER_SCHEMA_VERSION && parsed.ticketRules && parsed.ticket !== "ensure") {
    throw new EmpiricalError(
      "INVALID_TRACKER_POLICY",
      "Tracker ticketRules are valid only with ticket behavior ensure",
    );
  }
  if (containsSecretLikeValue(parsed)) {
    throw new EmpiricalError(
      "INVALID_TRACKER_POLICY",
      "Tracker policy contains a secret-like value; persist only provider identifiers and credential environment-variable names",
    );
  }
  return parsed;
}

export function parseTrackerSetupChange(value: unknown): TrackerSetupChange {
  let parsed: TrackerSetupChange;
  try {
    parsed = trackerSetupChangeSchema.parse(value) as TrackerSetupChange;
  } catch (error) {
    throw new EmpiricalError(
      "INVALID_TRACKER_SETUP",
      "Tracker setup must strictly preserve, disable, or apply one secret-free tracker policy",
      error,
    );
  }
  return parsed.mode === "apply"
    ? { ...parsed, policy: parseTrackerPolicy(parsed.policy) }
    : parsed;
}

export function effectiveTrackerPolicy(policy: TrackerPolicy): EffectiveTrackerPolicy {
  return policy.schemaVersion === TRACKER_LEGACY_SCHEMA_VERSION
    ? {
        policy,
        schemaVersion: TRACKER_LEGACY_SCHEMA_VERSION,
        ticket: "manual",
        visibility: "legacy",
        compatibility: "v1",
      }
    : {
        policy,
        schemaVersion: TRACKER_SCHEMA_VERSION,
        ticket: policy.ticket,
        visibility: policy.visibility,
        compatibility: "v2",
        ...(policy.ticketRules ? { ticketRules: policy.ticketRules } : {}),
      };
}

const RECOMMENDED_TRACKER_TICKET_RULES: TrackerTicketRules = {
  feature: { fast: "required", quick: "required", complex: "required" },
  fix: { fast: "optional", quick: "required", complex: "required" },
  chore: { fast: "optional", quick: "optional", complex: "optional" },
};

export function recommendedTrackerTicketRules(): TrackerTicketRules {
  return {
    feature: { ...RECOMMENDED_TRACKER_TICKET_RULES.feature },
    fix: { ...RECOMMENDED_TRACKER_TICKET_RULES.fix },
    chore: { ...RECOMMENDED_TRACKER_TICKET_RULES.chore },
  };
}

export function resolveTrackerTicketRequirement(
  policy: TrackerPolicy,
  state: Pick<WorkflowState, "request" | "profile">,
): TrackerTicketResolution {
  const changeType = inferChangeType(state.request ?? "");
  if (policy.schemaVersion === TRACKER_SCHEMA_VERSION && policy.ticketRules) {
    return {
      changeType,
      requirement: policy.ticketRules[changeType][state.profile],
      rules: true,
    };
  }
  const ticket = effectiveTrackerPolicy(policy).ticket;
  const requirement: TrackerTicketRequirement = ticket === "ensure"
    ? "required"
    : ticket === "off"
      ? "off"
      : "optional";
  return { changeType, requirement, rules: false };
}

export async function loadTrackerPolicy(root: string): Promise<TrackerPolicy | null> {
  return (await loadTrackerSetupState(root)).policy;
}

export async function loadTrackerSetupState(root: string): Promise<TrackerSetupState> {
  const path = trackerPolicyPath(root);
  await assertPlainTrackerPath(root, path);
  if (!(await isFile(path))) return { mode: "unconfigured", policy: null };
  const persisted = await readJson<unknown>(path, "INVALID_TRACKER_POLICY");
  if (disabledTrackerSetupSchema.safeParse(persisted).success) {
    return { mode: "disabled", policy: null };
  }
  return { mode: "configured", policy: parseTrackerPolicy(persisted) };
}

export async function configureTrackerPolicy(
  root: string,
  value: unknown,
  dependencies: TrackerDependencies = {},
): Promise<TrackerPolicy | null> {
  const path = trackerPolicyPath(root);
  await assertPlainTrackerPath(root, path);
  if (value === null) {
    await writeJsonAtomic(path, DISABLED_TRACKER_SETUP);
    return null;
  }
  const policy = parseTrackerPolicy(value);
  if (policy.schemaVersion === TRACKER_SCHEMA_VERSION) {
    await previewTrackerPolicy(policy, dependencies);
  }
  await writeJsonAtomic(path, policy);
  return policy;
}

export async function discoverTracker(
  value: unknown,
  dependencies: TrackerDependencies = {},
): Promise<TrackerDiscovery> {
  const input = parseTrackerDiscoveryInput(value);
  const authentication = await resolveTrackerAuthentication(input, dependencies);
  const resources = input.provider === "linear"
    ? await discoverLinearResources(linearAuthorizationFor(authentication), dependencies)
    : input.provider === "github"
      ? await discoverGitHubResources(accessTokenFor(authentication, "github"), dependencies)
      : await discoverJiraResources(input.target.siteUrl, authentication, dependencies);
  const unique = new Map<string, TrackerDiscoveryResource>();
  for (const resource of resources) {
    validateDiscoveryResource(resource);
    const identity = `${resource.kind}\0${resource.parentId ?? ""}\0${resource.id}`;
    const previous = unique.get(identity);
    if (previous && digestJson(previous) !== digestJson(resource)) {
      throw new EmpiricalError(
        "TRACKER_DISCOVERY_AMBIGUOUS",
        `Provider discovery returned conflicting ${resource.kind} identity ${resource.id}`,
      );
    }
    unique.set(identity, resource);
  }
  const discovered = [...unique.values()];
  for (const resource of discovered) {
    if (resource.parentId !== null && !discovered.some((candidate) => candidate.id === resource.parentId)) {
      throw new EmpiricalError(
        "TRACKER_DISCOVERY_INCOMPLETE",
        `Provider discovery returned ${resource.kind} ${resource.id} without its parent`,
      );
    }
  }
  const body = {
    schemaVersion: 1 as const,
    provider: input.provider,
    resources: discovered.sort(compareDiscoveryResources),
    capabilities: trackerAdapterCapabilities(input.provider),
    complete: true as const,
  };
  return { ...body, digest: digestJson(body) };
}

export function suggestTrackerStateMapping(
  discovery: TrackerDiscovery,
  stateParentId?: string,
): TrackerMappingSuggestion {
  verifyTrackerDiscovery(discovery);
  const states = discovery.resources.filter((resource) =>
    resource.kind === "state" && (stateParentId === undefined || resource.parentId === stateParentId));
  if (states.length === 0) {
    throw new EmpiricalError("TRACKER_STATES_MISSING", "Tracker discovery returned no workflow states");
  }
  const positioned = normalizedStatePositions(states);
  const phases = Object.fromEntries(TRACKER_PROGRESS_STATES.map((phase) => {
    const candidates = states.map((state) => mappingCandidate(discovery.provider, phase, state, positioned.get(state.id)!))
      .sort((left, right) => left.primaryRank - right.primaryRank
        || left.nameRank - right.nameRank
        || left.name.localeCompare(right.name)
        || left.stateId.localeCompare(right.stateId));
    const best = candidates[0]!;
    const noCompatibleCandidate = best.primaryRank >= 5_000_000;
    const ambiguous = noCompatibleCandidate
      || candidates.filter((candidate) => candidate.primaryRank === best.primaryRank).length > 1;
    return [phase, {
      phase,
      selectedStateId: ambiguous ? null : best.stateId,
      ambiguous,
      candidates,
    }];
  })) as TrackerMappingSuggestion["phases"];
  const ambiguous = TRACKER_PROGRESS_STATES.filter((phase) => phases[phase].ambiguous);
  const statesMap = ambiguous.length === 0
    ? Object.fromEntries(TRACKER_PROGRESS_STATES.map((phase) => [phase, phases[phase].selectedStateId!])) as TrackerStateMap
    : null;
  return { provider: discovery.provider, phases, states: statesMap, ambiguous };
}

export async function proposeTrackerStateMapping(
  value: unknown,
  dependencies: TrackerDependencies = {},
): Promise<TrackerMappingSuggestion> {
  let parsed: { input: TrackerDiscoveryInput; stateParentId: string };
  try {
    parsed = trackerMappingInputSchema.parse(value) as typeof parsed;
  } catch (error) {
    throw new EmpiricalError(
      "INVALID_TRACKER_MAPPING_INPUT",
      "Tracker mapping requires one strict discovery input and discovered state parent identifier",
      error,
    );
  }
  const discovery = await discoverTracker(parsed.input, dependencies);
  return suggestTrackerStateMapping(discovery, parsed.stateParentId);
}

export async function previewTrackerPolicy(
  value: unknown,
  dependencies: TrackerDependencies = {},
): Promise<TrackerPolicyPreview> {
  const policy = parseTrackerPolicy(value);
  const discovery = await discoverTracker(discoveryInputForPolicy(policy), dependencies);
  const suggested = suggestTrackerStateMapping(discovery, policyStateParent(policy));
  const validated = validatePolicySelection(policy, discovery, suggested);
  const effective = effectiveTrackerPolicy(policy);
  const body = {
    schemaVersion: 1 as const,
    policy,
    effective: {
      ticket: effective.ticket,
      visibility: effective.visibility,
      compatibility: effective.compatibility,
    },
    target: validated.target,
    mapping: validated.mapping,
    valid: true as const,
  };
  return { ...body, digest: digestJson(body) };
}

export function trackerProgress(state: WorkflowState): TrackerProgressState {
  if (state.status === "blocked" || state.status === "awaiting_human") return "blocked";
  if (state.phase === "done") return "done";
  if (["shape", "specify", "design", "idle"].includes(state.phase)) return "specification";
  if (state.phase === "plan") return "planned";
  if (state.phase === "implement" || state.phase === "context") return "in-progress";
  if (state.phase === "verify") return "verification";
  return "review";
}

export function createTrackerProjection(
  state: WorkflowState,
  policy?: TrackerPolicy | null,
  artifacts: TrackerArtifact[] = [],
): TrackerProjection {
  if (!state.activeFeature) {
    throw new EmpiricalError("TRACKER_FEATURE_REQUIRED", "Tracker projection requires an active feature");
  }
  const legacy = !policy || policy.schemaVersion === TRACKER_LEGACY_SCHEMA_VERSION;
  const receiptIds = [...new Set(state.evidenceReceiptIds)].sort();
  const body = {
    schemaVersion: legacy ? TRACKER_LEGACY_SCHEMA_VERSION : TRACKER_SCHEMA_VERSION,
    feature: state.activeFeature,
    phase: state.phase,
    status: state.status,
    revision: state.revision,
    completionLevel: state.completion.highest,
    progress: trackerProgress(state),
    summary: legacy
      ? state.status === "blocked" || state.status === "awaiting_human"
        ? safeText(state.message ?? "Empirical is waiting at a workflow gate")
        : null
      : state.message ? safeText(state.message) : null,
    ...(!legacy ? {
      blocker: state.status === "blocked" || state.status === "awaiting_human"
        ? safeText(state.message ?? "Empirical is waiting at a workflow gate")
        : null,
      receiptIds,
      receiptDigest: digestJson(receiptIds),
      artifacts,
    } : {}),
    marker: `empirical-sdd:${state.activeFeature}:r${state.revision}`,
  };
  return trackerProjectionSchema.parse({ ...body, digest: digestJson(body) }) as TrackerProjection;
}

async function createTrackerProjectionForRoot(
  root: string,
  state: WorkflowState,
  policy: TrackerPolicy,
): Promise<TrackerProjection> {
  const artifacts = policy.schemaVersion === TRACKER_SCHEMA_VERSION
    ? await loadTrackerArtifacts(root, state, policy)
    : [];
  return createTrackerProjection(state, policy, artifacts);
}

async function loadTrackerArtifacts(
  root: string,
  state: WorkflowState,
  policy: TrackerPolicy,
): Promise<TrackerArtifact[]> {
  if (!state.activeFeature || state.evidenceReceiptIds.length === 0) return [];
  const canonicalRoot = await realpath(resolve(root));
  const repositoryLink = await repositoryLinkContext(root);
  const artifacts: TrackerArtifact[] = [];
  let totalBytes = 0;
  for (const receiptId of [...new Set(state.evidenceReceiptIds)].sort()) {
    if (artifacts.length >= TRACKER_ARTIFACT_MAX_COUNT) break;
    const path = join(
      root,
      ".empirical",
      "specs",
      state.activeFeature,
      "evidence",
      "receipts",
      `${receiptId}.json`,
    );
    let receipt: EvidenceReceipt;
    try {
      receipt = evidenceReceiptSchema.parse(JSON.parse(await readFile(path, "utf8")) as unknown);
      verifyReceiptDigest(receipt);
    } catch (error) {
      throw new EmpiricalError(
        "TRACKER_ARTIFACT_RECEIPT_INVALID",
        `Committed evidence receipt ${receiptId} cannot be validated for tracker projection`,
        error,
      );
    }
    if (receipt.id !== receiptId || receipt.provenance.feature !== state.activeFeature) {
      throw new EmpiricalError(
        "TRACKER_ARTIFACT_RECEIPT_INVALID",
        `Committed evidence receipt ${receiptId} belongs to another feature`,
      );
    }
    if (receipt.kind !== "collected") continue;
    for (const artifact of receipt.artifacts) {
      if (artifacts.length >= TRACKER_ARTIFACT_MAX_COUNT) break;
      if (!TRACKER_ARTIFACT_MEDIA.has(artifact.mediaType)) {
        throw new EmpiricalError(
          "TRACKER_ARTIFACT_UNSAFE",
          `Evidence artifact ${artifact.path} has an unsupported media type`,
        );
      }
      if (isSecretLikeArtifactPath(artifact.path)) {
        throw new EmpiricalError("TRACKER_ARTIFACT_UNSAFE", "A secret-like evidence artifact path cannot be projected");
      }
      const absolute = resolve(canonicalRoot, artifact.path);
      const contained = relative(canonicalRoot, absolute);
      if (contained === ".." || contained.startsWith("../") || contained.startsWith("..\\")) {
        throw new EmpiricalError("TRACKER_ARTIFACT_UNSAFE", "An evidence artifact escapes the repository");
      }
      const metadata = await lstat(absolute).catch(() => null);
      if (!metadata || metadata.isSymbolicLink() || !metadata.isFile()) {
        throw new EmpiricalError("TRACKER_ARTIFACT_UNSAFE", "An evidence artifact is missing or is not a regular file");
      }
      const resolvedArtifact = await realpath(absolute);
      const resolvedRelative = relative(canonicalRoot, resolvedArtifact);
      if (resolvedRelative === ".." || resolvedRelative.startsWith("../") || resolvedRelative.startsWith("..\\")) {
        throw new EmpiricalError("TRACKER_ARTIFACT_UNSAFE", "An evidence artifact resolves outside the repository");
      }
      if (metadata.size !== artifact.bytes || metadata.size > TRACKER_ARTIFACT_MAX_BYTES) {
        throw new EmpiricalError("TRACKER_ARTIFACT_UNSAFE", "An evidence artifact exceeds tracker size bounds or changed size");
      }
      totalBytes += metadata.size;
      if (totalBytes > TRACKER_ARTIFACT_TOTAL_BYTES) {
        throw new EmpiricalError("TRACKER_ARTIFACT_UNSAFE", "Tracker evidence artifacts exceed the total size bound");
      }
      const bytes = await readFile(resolvedArtifact);
      if (sha256(bytes) !== artifact.digest) {
        throw new EmpiricalError("TRACKER_ARTIFACT_UNSAFE", "An evidence artifact changed after its receipt was committed");
      }
      const artifactPath = relative(canonicalRoot, resolvedArtifact).replaceAll("\\", "/");
      artifacts.push({
        receiptId,
        path: artifactPath,
        mediaType: artifact.mediaType,
        digest: artifact.digest,
        size: artifact.bytes,
        url: await artifactDurableUrl(root, repositoryLink, artifactPath, artifact.digest),
      });
    }
  }
  return artifacts;
}

function isSecretLikeArtifactPath(path: string): boolean {
  return /(^|\/)(?:\.env(?:\.[^\/]*)?|\.npmrc|\.netrc|id_(?:rsa|dsa|ecdsa|ed25519)|credentials?(?:\.[^\/]*)?|secrets?(?:\.[^\/]*)?|tokens?(?:\.[^\/]*)?|private[-_.]?key(?:\.[^\/]*)?)(?:\/|$)/i.test(path);
}

interface RepositoryLinkContext {
  repositoryUrl: string;
  commit: string;
}

async function repositoryLinkContext(root: string): Promise<RepositoryLinkContext | null> {
  try {
    const [remoteBytes, commitBytes] = await Promise.all([
      gitOutput(root, ["config", "--get", "remote.origin.url"], 16_384),
      gitOutput(root, ["rev-parse", "--verify", "HEAD"], 16_384),
    ]);
    const repositoryUrl = githubRepositoryUrl(remoteBytes.toString("utf8").trim());
    const commit = commitBytes.toString("utf8").trim().toLowerCase();
    if (!repositoryUrl || !/^[a-f0-9]{40,64}$/.test(commit)) return null;
    return { repositoryUrl, commit };
  } catch {
    return null;
  }
}

async function artifactDurableUrl(
  root: string,
  context: RepositoryLinkContext | null,
  path: string,
  digest: string,
): Promise<string | null> {
  if (!context || /[\0\r\n]/.test(path)) return null;
  try {
    const committed = await gitOutput(
      root,
      ["show", "--no-ext-diff", "--no-textconv", `${context.commit}:${path}`],
      TRACKER_ARTIFACT_MAX_BYTES + 1,
    );
    if (sha256(committed) !== digest) return null;
    const url = `${context.repositoryUrl}/blob/${context.commit}/${path.split("/").map(encodeURIComponent).join("/")}`;
    return url.length <= 2_048 ? url : null;
  } catch {
    return null;
  }
}

function githubRepositoryUrl(value: string): string | null {
  const ssh = /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(value);
  if (ssh) return `https://github.com/${encodeURIComponent(ssh[1]!)}/${encodeURIComponent(ssh[2]!)}`;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (
    !["https:", "ssh:"].includes(url.protocol)
    || url.hostname.toLowerCase() !== "github.com"
    || url.port
    || url.username && url.protocol === "https:"
    || url.password
    || url.search
    || url.hash
  ) return null;
  const segments = url.pathname.replace(/\.git$/, "").split("/").filter(Boolean);
  if (segments.length !== 2 || !segments.every((segment) => /^[A-Za-z0-9_.-]+$/.test(segment))) return null;
  return `https://github.com/${encodeURIComponent(segments[0]!)}/${encodeURIComponent(segments[1]!)}`;
}

function gitOutput(root: string, args: string[], maxBuffer: number): Promise<Buffer> {
  return new Promise((resolveOutput, rejectOutput) => {
    execFile(
      "git",
      ["-C", resolve(root), ...args],
      { encoding: null, maxBuffer, windowsHide: true },
      (error, stdout) => error ? rejectOutput(error) : resolveOutput(Buffer.from(stdout)),
    );
  });
}

export async function trackerStatus(
  root: string,
  state: WorkflowState,
  dependencies: TrackerDependencies = {},
): Promise<TrackerStatus> {
  if (!state.activeFeature) return localOnlyStatus(state.revision);
  let policy: TrackerPolicy | null;
  try {
    policy = await loadTrackerPolicy(root);
  } catch (error) {
    return failedStatus(state.revision, null, null, null, failureFrom(error, dependencies));
  }
  if (!policy) return localOnlyStatus(state.revision);
  const resolution = resolveTrackerTicketRequirement(policy, state);
  if (resolution.requirement === "off") {
    return trackerStatusWithPolicy(offStatus(state.revision, policy), policy, null, null, state);
  }
  try {
    const [binding, pending] = await Promise.all([
      loadTrackerBinding(root, state.activeFeature),
      loadTrackerPending(root, state.activeFeature),
    ]);
    const enrich = (
      status: TrackerStatus,
      statusPending: TrackerPendingRecord | null = pending,
      statusBinding: TrackerBinding | null = binding,
    ): TrackerStatus => trackerStatusWithPolicy(status, policy, statusPending, statusBinding, state);
    if (
      binding
      && pending?.replacesBindingDigest === binding.digest
      && pending.idempotencyKey !== binding.bindIdempotencyKey
    ) {
      try {
        assertPendingScope(policy, pending);
      } catch (error) {
        return enrich(failedStatus(
          state.revision,
          policy.provider,
          null,
          null,
          failureFrom(error, dependencies),
          pending.projection.revision,
        ));
      }
      if (pending.status === "failed") {
        return enrich(failedStatus(state.revision, policy.provider, null, null, pending.failure, pending.projection.revision));
      }
      return enrich({
        health: "pending",
        provider: policy.provider,
        url: null,
        committedRevision: state.revision,
        lastSyncedRevision: null,
        pendingRevision: pending.projection.revision,
        failure: null,
      });
    }
    if (binding && binding.provider !== policy.provider) {
      return enrich(failedStatus(
        state.revision,
        policy.provider,
        null,
        binding.lastSyncedRevision,
        failure("TRACKER_PROVIDER_MISMATCH", "The feature binding belongs to a different configured provider", dependencies),
      ));
    }
    if (binding && binding.targetDigest !== trackerTargetDigest(policy)) {
      return enrich(failedStatus(
        state.revision,
        policy.provider,
        null,
        binding.lastSyncedRevision,
        failure("TRACKER_TARGET_MISMATCH", "The feature binding belongs to a different configured target", dependencies),
      ));
    }
    if (binding) {
      try {
        assertBindingScope(policy, binding);
      } catch (error) {
        return enrich(failedStatus(
          state.revision,
          policy.provider,
          null,
          binding.lastSyncedRevision,
          failureFrom(error, dependencies),
        ));
      }
    }
    if (pending && pending.targetDigest !== trackerTargetDigest(policy)) {
      return enrich(failedStatus(
        state.revision,
        policy.provider,
        binding?.url ?? null,
        binding?.lastSyncedRevision ?? null,
        failure("TRACKER_TARGET_MISMATCH", "Pending tracker work belongs to a different configured target", dependencies),
        pending.projection.revision,
      ));
    }
    if (!binding) {
      if (!pending) return enrich(localOnlyStatus(state.revision));
      if (pending?.status === "failed") {
        return enrich(failedStatus(state.revision, policy.provider, null, null, pending.failure));
      }
      return enrich({
        health: "pending",
        provider: policy.provider,
        url: null,
        committedRevision: state.revision,
        lastSyncedRevision: null,
        pendingRevision: pending?.projection.revision ?? state.revision,
        failure: null,
      });
    }
    if (
      binding.lastSyncedRevision === state.revision
      && binding.lastSyncedDigest === (await createTrackerProjectionForRoot(root, state, policy)).digest
      && binding.lastSyncedPolicyDigest === trackerProjectionPolicyDigest(policy)
      && (!pending || pending.status === "synced")
    ) {
      return enrich({
        health: "synced",
        provider: binding.provider,
        url: binding.url,
        committedRevision: state.revision,
        lastSyncedRevision: binding.lastSyncedRevision,
        pendingRevision: null,
        failure: null,
      });
    }
    if (pending?.status === "failed" && pending.projection.revision >= (binding.lastSyncedRevision ?? -1)) {
      return enrich(failedStatus(
        state.revision,
        binding.provider,
        binding.url,
        binding.lastSyncedRevision,
        pending.failure,
        pending.projection.revision,
      ));
    }
    return enrich({
      health: "pending",
      provider: binding.provider,
      url: binding.url,
      committedRevision: state.revision,
      lastSyncedRevision: binding.lastSyncedRevision,
      pendingRevision: pending?.projection.revision ?? state.revision,
      failure: null,
    });
  } catch (error) {
    return trackerStatusWithPolicy(
      failedStatus(state.revision, policy.provider, null, null, failureFrom(error, dependencies)),
      policy,
      null,
      null,
      state,
    );
  }
}

export async function bindTracker(
  root: string,
  state: WorkflowState,
  input: TrackerBindInput,
  dependencies: TrackerDependencies = {},
): Promise<TrackerBindResult> {
  input = parseTrackerBindInput(input);
  if (!state.activeFeature || state.phase === "idle") {
    throw new EmpiricalError("TRACKER_FEATURE_REQUIRED", "Create or attach a ticket only after a feature starts");
  }
  const feature = state.activeFeature;
  const policy = await requireTrackerPolicy(root);
  if (resolveTrackerTicketRequirement(policy, state).requirement === "off") {
    throw new EmpiricalError("TRACKER_TICKET_POLICY_OFF", "Tracker ticket behavior is off; enable manual or ensure before binding");
  }
  const result = await withTrackerLock(root, feature, async () => {
    const existing = await loadTrackerBinding(root, feature);
    if (existing && input.replace !== true) assertBindingScope(policy, existing);
    if (existing && input.replace !== true) {
      if (input.mode === "attach" && input.ticket === existing.remoteKey) {
        return { binding: existing, tracker: await trackerStatus(root, state, dependencies) };
      }
      throw new EmpiricalError(
        "TRACKER_ALREADY_BOUND",
        `Feature ${state.activeFeature} is already bound to ${existing.provider}:${existing.remoteKey}`,
      );
    }
    const projection = await createTrackerProjectionForRoot(root, state, policy);
    const durablePending = await loadTrackerPending(root, feature);
    const unresolvedDispatchedCreate = Boolean(
      durablePending?.intent.mode === "create"
      && durablePending.intent.dispatched
      && durablePending.status !== "synced"
      && (!existing || durablePending.replacesBindingDigest === existing.digest),
    );
    const recoverAmbiguousByAttach = unresolvedDispatchedCreate
      && input.mode === "attach";
    const supersedesPreparedPending = input.replace === true
      && durablePending !== null
      && (durablePending.intent.mode === "attach" || !durablePending.intent.dispatched);
    const supersedesAcknowledgedPending = input.replace === true
      && existing !== null
      && durablePending?.replacesBindingDigest !== existing.digest;
    const previousPending = supersedesPreparedPending || supersedesAcknowledgedPending
      ? null
      : durablePending;
    if (previousPending) assertPendingScope(policy, previousPending);
    const intent = trackerBindIntent(feature, input);
    let credentials: ResolvedTrackerAuthentication;
    try {
      credentials = await resolveTrackerAuthentication(policy, withTrackerRepositoryRoot(dependencies, root));
    } catch (error) {
      if (recoverAmbiguousByAttach && durablePending) {
        const recorded = await persistFailure(root, durablePending, error, dependencies);
        return failedBindResult(state, policy, null, recorded);
      }
      const pending = await persistPending(
        root,
        policy,
        projection,
        intent,
        previousPending,
        dependencies,
        false,
        input.replace === true ? existing?.digest ?? null : previousPending?.replacesBindingDigest ?? null,
      );
      const recorded = await persistFailure(root, (await loadTrackerPending(root, feature)) ?? pending, error, dependencies);
      return failedBindResult(state, policy, existing, recorded);
    }

    if (recoverAmbiguousByAttach && input.mode === "attach" && durablePending) {
      let recoveredBinding: TrackerBinding;
      try {
        const remote = await attachAmbiguousCreate(policy, input.ticket, durablePending, credentials, dependencies);
        recoveredBinding = createBinding(feature, policy, remote, durablePending.idempotencyKey);
        await writeTrackerBinding(root, recoveredBinding);
      } catch (error) {
        return {
          binding: null,
          tracker: failedStatus(
            state.revision,
            policy.provider,
            null,
            null,
            failureFrom(error, dependencies),
            durablePending.projection.revision,
          ),
        };
      }
      const pending = await persistPending(
        root,
        policy,
        projection,
        durablePending.intent,
        durablePending,
        dependencies,
      );
      try {
        return await synchronizeBound(root, state, policy, recoveredBinding, pending, credentials, dependencies);
      } catch (error) {
        const recorded = await persistFailure(root, (await loadTrackerPending(root, feature)) ?? pending, error, dependencies);
        return failedBindResult(state, policy, recoveredBinding, recorded);
      }
    }

    if (
      input.mode === "create"
      && previousPending?.intent.mode === "create"
      && previousPending.intent.dispatched
      && (!existing || previousPending.replacesBindingDigest === existing.digest)
    ) {
      let recoveredBinding: TrackerBinding | null = null;
      try {
        const reconciled = await reconcileCreate(policy, previousPending, credentials, dependencies);
        if (reconciled) {
          recoveredBinding = createBinding(feature, policy, reconciled, previousPending.idempotencyKey);
          await writeTrackerBinding(root, recoveredBinding);
        }
      } catch (error) {
        const recorded = await persistFailure(root, previousPending, error, dependencies);
        return failedBindResult(state, policy, null, recorded);
      }
      if (recoveredBinding) {
        const pending = await persistPending(
          root,
          policy,
          projection,
          previousPending.intent,
          previousPending,
          dependencies,
        );
        try {
          return await synchronizeBound(root, state, policy, recoveredBinding, pending, credentials, dependencies);
        } catch (error) {
          const recorded = await persistFailure(root, (await loadTrackerPending(root, feature)) ?? pending, error, dependencies);
          return failedBindResult(state, policy, recoveredBinding, recorded);
        }
      }
      if (input.confirmCreateRetry !== true) {
        throw new EmpiricalError(
          "TRACKER_CREATE_CONFIRMATION_REQUIRED",
          "The prior create may have succeeded; reconciliation found no exact marker, so a new create requires explicit confirmation",
        );
      }
    }

    const pending = await persistPending(
      root,
      policy,
      projection,
      intent,
      previousPending,
      dependencies,
      input.mode === "create" && previousPending?.intent.mode === "create" && input.confirmCreateRetry === true,
      input.replace === true ? existing?.digest ?? null : previousPending?.replacesBindingDigest ?? null,
    );
    let activePending = pending;
    let binding: TrackerBinding;
    try {
      if (input.mode === "create") activePending = await markCreateDispatched(root, pending, dependencies);
      const remote = input.mode === "create"
        ? await createRemoteTicket(policy, projection, activePending.intent as Extract<TrackerBindIntent, { mode: "create" }>, activePending.idempotencyKey, credentials, dependencies)
        : await attachRemoteTicket(policy, input.ticket, credentials, dependencies);
      binding = createBinding(feature, policy, remote, activePending.idempotencyKey);
      await writeTrackerBinding(root, binding);
    } catch (error) {
      const recorded = await persistFailure(
        root,
        activePending,
        input.mode === "create"
          ? new EmpiricalError("TRACKER_CREATE_AMBIGUOUS", "The provider create outcome could not be durably confirmed")
          : error,
        dependencies,
      );
      return failedBindResult(state, policy, existing, recorded);
    }

    try {
      const synced = await synchronizeBound(root, state, policy, binding, activePending, credentials, dependencies);
      return { binding: synced.binding, tracker: synced.tracker };
    } catch (error) {
      const recorded = await persistFailure(
        root,
        (await loadTrackerPending(root, feature)) ?? activePending,
        error,
        dependencies,
      );
      return failedBindResult(state, policy, binding, recorded);
    }
  });
  const pending = await loadTrackerPending(root, feature);
  return {
    ...result,
    tracker: trackerStatusWithPolicy(result.tracker, policy, pending, result.binding, state),
  };
}

export async function synchronizeTracker(
  root: string,
  state: WorkflowState,
  dependencies: TrackerDependencies = {},
): Promise<TrackerSyncResult> {
  if (!state.activeFeature || state.phase === "idle") {
    return { binding: null, tracker: localOnlyStatus(state.revision), projection: null };
  }
  const policy = await loadTrackerPolicy(root);
  if (!policy) return { binding: null, tracker: localOnlyStatus(state.revision), projection: null };
  const resolution = resolveTrackerTicketRequirement(policy, state);
  if (resolution.requirement === "off") {
    return {
      binding: null,
      tracker: trackerStatusWithPolicy(offStatus(state.revision, policy), policy, null, null, state),
      projection: createTrackerProjection(state, policy, []),
    };
  }
  const result = await withTrackerLock<TrackerSyncResult>(root, state.activeFeature, async () => {
    const feature = state.activeFeature!;
    let binding = await loadTrackerBinding(root, feature);
    let previousPending = await loadTrackerPending(root, feature);
    let projection: TrackerProjection;
    try {
      projection = await createTrackerProjectionForRoot(root, state, policy);
    } catch (error) {
      return {
        binding,
        projection: null,
        tracker: failedStatus(
          state.revision,
          policy.provider,
          binding?.url ?? null,
          binding?.lastSyncedRevision ?? null,
          failureFrom(error, dependencies),
          state.revision,
        ),
      };
    }
    const bindingIsSuperseded = Boolean(
      binding
      && previousPending?.replacesBindingDigest === binding.digest
      && previousPending.idempotencyKey !== binding.bindIdempotencyKey,
    );
    if (
      !binding
      && !previousPending
      && (resolution.rules || effectiveTrackerPolicy(policy).ticket === "ensure")
    ) {
      const references = trackerReferences(state.request, policy);
      if (resolution.rules && resolution.requirement === "optional" && references.length === 0) {
        return { binding: null, tracker: localOnlyStatus(state.revision), projection };
      }
      if (resolution.rules && references.length > 1) {
        return {
          binding: null,
          projection,
          tracker: failedStatus(
            state.revision,
            policy.provider,
            null,
            null,
            failure(
              "TRACKER_BIND_AMBIGUOUS",
              "The feature request references multiple target-valid ticket candidates; choose one explicitly",
              dependencies,
            ),
            projection.revision,
          ),
        };
      }
      const intent = references.length === 1
        ? trackerBindIntent(feature, { mode: "attach", ticket: references[0]! })
        : trackerBindIntent(feature, { mode: "create" });
      previousPending = await persistPending(
        root,
        policy,
        projection,
        intent,
        null,
        dependencies,
      );
      if (references.length > 1) {
        const recorded = await persistFailure(
          root,
          previousPending,
          new EmpiricalError(
            "TRACKER_BIND_AMBIGUOUS",
            "The feature request references multiple target-valid ticket candidates; choose one explicitly",
          ),
          dependencies,
        );
        return {
          binding: null,
          projection,
          tracker: failedStatus(
            state.revision,
            policy.provider,
            null,
            null,
            recorded.failure,
            projection.revision,
          ),
        };
      }
    }
    if (!binding || bindingIsSuperseded) {
      if (!previousPending) {
        return { binding: null, tracker: await trackerStatus(root, state, dependencies), projection };
      }
      try {
        assertPendingScope(policy, previousPending);
      } catch (error) {
        return {
          binding: null,
          projection,
          tracker: failedStatus(state.revision, policy.provider, null, null, failureFrom(error, dependencies), previousPending.projection.revision),
        };
      }
      let credentials: ResolvedTrackerAuthentication;
      try {
        credentials = await resolveTrackerAuthentication(policy, withTrackerRepositoryRoot(dependencies, root));
      } catch (error) {
        const recorded = await persistFailure(root, previousPending, error, dependencies);
        return { binding: null, projection, tracker: failedStatus(state.revision, policy.provider, null, null, recorded.failure, projection.revision) };
      }
      let recoveryPending = previousPending;
      let dispatchedCreateNow = false;
      try {
        let remote: RemoteTicket | null;
        if (previousPending.intent.mode === "attach") {
          remote = await attachRemoteTicket(policy, previousPending.intent.ticket, credentials, dependencies);
        } else if (!previousPending.intent.dispatched) {
          remote = effectiveTrackerPolicy(policy).ticket === "ensure"
            ? await reconcileFeatureMarker(policy, previousPending.intent.marker, credentials, dependencies)
            : null;
          if (!remote) {
            recoveryPending = await markCreateDispatched(root, previousPending, dependencies);
            dispatchedCreateNow = true;
            remote = await createRemoteTicket(
              policy,
              recoveryPending.projection,
              recoveryPending.intent as Extract<TrackerBindIntent, { mode: "create" }>,
              recoveryPending.idempotencyKey,
              credentials,
              dependencies,
            );
          }
        } else {
          remote = await reconcileCreate(policy, previousPending, credentials, dependencies);
        }
        if (!remote) {
          throw new EmpiricalError(
            "TRACKER_CREATE_AMBIGUOUS",
            "No exact provider marker was found; sync will not issue a blind replacement create",
          );
        }
        binding = createBinding(feature, policy, remote, recoveryPending.idempotencyKey);
        await writeTrackerBinding(root, binding);
      } catch (error) {
        const recorded = await persistFailure(
          root,
          recoveryPending,
          dispatchedCreateNow
            ? new EmpiricalError("TRACKER_CREATE_AMBIGUOUS", "The provider create outcome could not be durably confirmed")
            : error,
          dependencies,
        );
        return { binding: null, projection, tracker: failedStatus(state.revision, policy.provider, null, null, recorded.failure, projection.revision) };
      }
      const pending = await persistPending(
        root,
        policy,
        projection,
        recoveryPending.intent,
        recoveryPending,
        dependencies,
      );
      try {
        return await synchronizeBound(root, state, policy, binding, pending, credentials, dependencies);
      } catch (error) {
        const recorded = await persistFailure(root, (await loadTrackerPending(root, feature)) ?? pending, error, dependencies);
        return {
          binding,
          projection,
          tracker: failedStatus(state.revision, policy.provider, binding.url, binding.lastSyncedRevision, recorded.failure, projection.revision),
        };
      }
    }
    try {
      assertBindingScope(policy, binding);
      if (previousPending) assertPendingScope(policy, previousPending);
    } catch (error) {
      const mismatch = failureFrom(error, dependencies);
      return {
        binding,
        tracker: failedStatus(state.revision, policy.provider, binding.url, binding.lastSyncedRevision, mismatch),
        projection,
      };
    }
    if (
      binding.lastSyncedRevision === projection.revision
      && binding.lastSyncedDigest === projection.digest
      && binding.lastSyncedPolicyDigest === trackerProjectionPolicyDigest(policy)
    ) {
      if (
        previousPending
        && previousPending.projection.digest === projection.digest
        && previousPending.policyDigest === trackerProjectionPolicyDigest(policy)
        && previousPending.status !== "synced"
      ) {
        await writeTrackerPending(root, createPendingRecord({
          ...previousPending,
          replacesBindingDigest: null,
          status: "synced",
          failure: null,
          updatedAt: now(dependencies),
        }));
      }
      return {
        binding,
        projection,
        tracker: {
          health: "synced",
          provider: binding.provider,
          url: binding.url,
          committedRevision: state.revision,
          lastSyncedRevision: state.revision,
          pendingRevision: null,
          failure: null,
        },
      };
    }
    const intent = previousPending?.intent ?? { mode: "attach", ticket: binding.remoteKey };
    const pending = await persistPending(root, policy, projection, intent, previousPending, dependencies);
    try {
      const credentials = await resolveTrackerAuthentication(policy, withTrackerRepositoryRoot(dependencies, root));
      return await synchronizeBound(
        root,
        state,
        policy,
        binding,
        pending,
        credentials,
        dependencies,
      );
    } catch (error) {
      const recorded = await persistFailure(root, (await loadTrackerPending(root, feature)) ?? pending, error, dependencies);
      return {
        binding,
        projection,
        tracker: failedStatus(
          state.revision,
          binding.provider,
          binding.url,
          binding.lastSyncedRevision,
          recorded.failure,
          projection.revision,
        ),
      };
    }
  });
  const pending = await loadTrackerPending(root, state.activeFeature);
  return {
    ...result,
    tracker: trackerStatusWithPolicy(result.tracker, policy, pending, result.binding, state),
  };
}

export const defaultTrackerTransport: TrackerTransport = async (
  request: TrackerHttpRequest,
): Promise<TrackerHttpResponse> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.body === undefined ? {} : { body: request.body }),
      signal: controller.signal,
      redirect: "error",
    });
    const length = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(length) && length > request.maxResponseBytes) {
      throw new EmpiricalError("TRACKER_RESPONSE_TOO_LARGE", "Tracker response exceeds the configured limit");
    }
    const bytes = await readBoundedResponse(response, request.maxResponseBytes);
    return { status: response.status, body: new TextDecoder().decode(bytes) };
  } catch (error) {
    if (error instanceof EmpiricalError) throw error;
    throw new EmpiricalError("TRACKER_TRANSPORT_FAILED", "Tracker request did not return a response");
  } finally {
    clearTimeout(timeout);
  }
};

async function readBoundedResponse(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel().catch(() => undefined);
        throw new EmpiricalError("TRACKER_RESPONSE_TOO_LARGE", "Tracker response exceeds the configured limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

async function synchronizeBound(
  root: string,
  state: WorkflowState,
  policy: TrackerPolicy,
  binding: TrackerBinding,
  pending: TrackerPendingRecord,
  credentials: ResolvedTrackerAuthentication,
  dependencies: TrackerDependencies,
): Promise<TrackerSyncResult> {
  let activePending = pending;
  let updated: RemoteTicket;
  if (policy.schemaVersion === TRACKER_SCHEMA_VERSION) {
    const result = await projectRemoteTicketV2(
      root,
      policy,
      binding,
      activePending,
      credentials,
      dependencies,
    );
    updated = result.remote;
    activePending = result.pending;
  } else {
    updated = await projectRemoteTicket(policy, binding, pending.projection, credentials, dependencies);
  }
  assertRemoteIdentity(binding, updated);
  const nextBinding = createBinding(state.activeFeature!, policy, {
    remoteId: updated.remoteId,
    remoteKey: updated.remoteKey,
    url: updated.url,
    projectItemId: updated.projectItemId,
    markerId: updated.markerId,
    lastSyncedRevision: activePending.projection.revision,
    lastSyncedDigest: activePending.projection.digest,
    lastSyncedPolicyDigest: activePending.policyDigest,
    lastSyncedPhase: activePending.projection.phase,
    lastSyncedStatus: activePending.projection.status,
    lastSyncedCompletionLevel: activePending.projection.completionLevel,
    lastSyncedReceiptDigest: activePending.projection.receiptDigest ?? null,
  }, binding.bindIdempotencyKey);
  await writeTrackerBinding(root, nextBinding);
  const acknowledged = createPendingRecord({
    ...activePending,
    replacesBindingDigest: null,
    status: "synced",
    failure: null,
    updatedAt: now(dependencies),
  });
  await writeTrackerPending(root, acknowledged);
  return {
    binding: nextBinding,
    projection: activePending.projection,
    tracker: {
      health: "synced",
      provider: nextBinding.provider,
      url: nextBinding.url,
      committedRevision: state.revision,
      lastSyncedRevision: nextBinding.lastSyncedRevision,
      pendingRevision: null,
      failure: null,
    },
  };
}

interface RemoteTicket {
  remoteId: string;
  remoteKey: string;
  url: string;
  projectItemId: string | null;
  markerId: string | null;
  lastSyncedRevision?: number | null;
  lastSyncedDigest?: string | null;
  lastSyncedPolicyDigest?: string | null;
  lastSyncedPhase?: TrackerBinding["lastSyncedPhase"];
  lastSyncedStatus?: TrackerBinding["lastSyncedStatus"];
  lastSyncedCompletionLevel?: TrackerBinding["lastSyncedCompletionLevel"];
  lastSyncedReceiptDigest?: string | null;
}

async function createRemoteTicket(
  policy: TrackerPolicy,
  projection: TrackerProjection,
  intent: Extract<TrackerBindIntent, { mode: "create" }>,
  idempotencyKey: string,
  credentials: ResolvedTrackerAuthentication,
  dependencies: TrackerDependencies,
): Promise<RemoteTicket> {
  if (policy.provider === "github") {
    return createGitHubTicket(policy, intent, idempotencyKey, accessTokenFor(credentials, "github"), dependencies);
  }
  if (policy.provider === "linear") {
    return createLinearTicket(policy, projection, intent, idempotencyKey, linearAuthorizationFor(credentials), dependencies);
  }
  return createJiraTicket(policy, projection, intent, idempotencyKey, credentials, dependencies);
}

async function attachRemoteTicket(
  policy: TrackerPolicy,
  ticket: string,
  credentials: ResolvedTrackerAuthentication,
  dependencies: TrackerDependencies,
): Promise<RemoteTicket> {
  if (!REMOTE_ID.test(ticket)) throw new EmpiricalError("INVALID_TRACKER_TICKET", "Tracker ticket id or key is invalid");
  if (policy.provider === "github") return attachGitHubTicket(policy, ticket, accessTokenFor(credentials, "github"), dependencies);
  if (policy.provider === "linear") return attachLinearTicket(policy, ticket, linearAuthorizationFor(credentials), dependencies);
  return attachJiraTicket(policy, ticket, credentials, dependencies);
}

async function attachAmbiguousCreate(
  policy: TrackerPolicy,
  ticket: string,
  pending: TrackerPendingRecord,
  credentials: ResolvedTrackerAuthentication,
  dependencies: TrackerDependencies,
): Promise<RemoteTicket> {
  if (pending.intent.mode !== "create" || !pending.intent.dispatched) {
    throw new EmpiricalError("INVALID_TRACKER_PENDING", "Ambiguous attach recovery requires a dispatched create intent");
  }
  if (policy.provider === "github") {
    const token = accessTokenFor(credentials, "github");
    if (!/^\d+$/.test(ticket)) throw new EmpiricalError("INVALID_TRACKER_TICKET", "GitHub attachment requires an issue number");
    const value = await requestJson(dependencies, {
      method: "GET",
      url: `https://api.github.com/repos/${encodeURIComponent(policy.target.owner)}/${encodeURIComponent(policy.target.repository)}/issues/${ticket}`,
      headers: githubHeaders(token),
    }, [200], [token]);
    const issue = record(value, "GitHub ambiguous create issue");
    const remote = parseGitHubIssue(policy, issue);
    if (remote.remoteKey !== ticket || !hasExactCreateMarker(issue.body, pending.intent, pending.idempotencyKey)) {
      throw new EmpiricalError("TRACKER_CREATE_MARKER_MISMATCH", "GitHub issue does not contain the exact pending create marker");
    }
    return remote;
  }
  if (policy.provider === "linear") {
    const accessToken = linearAuthorizationFor(credentials);
    const data = await linearGraphql(
      `query Issue($id: String!) { issue(id: $id) { id identifier url description team { id } project { id } } }`,
      { id: ticket },
      accessToken,
      dependencies,
    );
    const issue = record(data.issue, "Linear ambiguous create issue");
    const remote = parseLinearIssue(policy, issue);
    if (
      (ticket !== remote.remoteId && ticket !== remote.remoteKey)
      || !hasExactLinearCreateMarker(issue.description, pending.intent, pending.idempotencyKey)
    ) {
      throw new EmpiricalError("TRACKER_CREATE_MARKER_MISMATCH", "Linear issue does not contain the exact pending create marker");
    }
    return remote;
  }
  const jira = jiraRequestContext(policy.target.siteUrl, credentials);
  const value = await requestJson(dependencies, {
    method: "GET",
    url: `${jira.apiOrigin}/rest/api/3/issue/${encodeURIComponent(ticket)}?fields=status,project,issuetype&properties=empirical-sdd`,
    headers: jira.headers,
  }, [200], jira.secrets);
  const issue = record(value, "Jira ambiguous create issue");
  const remote = parseJiraIssue(policy, issue, true);
  const properties = record(issue.properties ?? {}, "Jira ambiguous create properties");
  const empirical = record(properties["empirical-sdd"] ?? {}, "Jira Empirical create property");
  const create = record(empirical.create ?? {}, "Jira Empirical create marker");
  if (
    (ticket !== remote.remoteId && ticket !== remote.remoteKey)
    || create.marker !== pending.intent.marker
    || create.idempotencyKey !== pending.idempotencyKey
  ) {
    throw new EmpiricalError("TRACKER_CREATE_MARKER_MISMATCH", "Jira issue does not contain the exact pending create marker");
  }
  return remote;
}

async function projectRemoteTicket(
  policy: TrackerPolicy,
  binding: TrackerBinding,
  projection: TrackerProjection,
  credentials: ResolvedTrackerAuthentication,
  dependencies: TrackerDependencies,
): Promise<RemoteTicket> {
  if (policy.provider === "github") return syncGitHubTicket(policy, binding, projection, accessTokenFor(credentials, "github"), dependencies);
  if (policy.provider === "linear") return syncLinearTicket(policy, binding, projection, linearAuthorizationFor(credentials), dependencies);
  return syncJiraTicket(policy, binding, projection, credentials, dependencies);
}

async function projectRemoteTicketV2(
  root: string,
  policy: TrackerPolicy,
  binding: TrackerBinding,
  pending: TrackerPendingRecord,
  credentials: ResolvedTrackerAuthentication,
  dependencies: TrackerDependencies,
): Promise<{ remote: RemoteTicket; pending: TrackerPendingRecord }> {
  let activePending = pending;
  const transitionKey = trackerEffectKey(policy, pending.projection, "transition");
  let remote: RemoteTicket;
  if (hasTrackerEffect(activePending, transitionKey)) {
    remote = { ...binding };
  } else {
    remote = await transitionRemoteTicketV2(policy, binding, pending.projection, credentials, dependencies);
    activePending = await acknowledgeTrackerEffect(
      root,
      activePending,
      { key: transitionKey, kind: "transition", remoteId: remote.remoteId, at: now(dependencies) },
    );
  }
  if (shouldPublishMilestone(policy, binding, pending.projection)) {
    const commentKey = trackerEffectKey(policy, pending.projection, "comment");
    if (!hasTrackerEffect(activePending, commentKey)) {
      const marker = milestoneMarker(commentKey);
      const commentId = await publishRemoteMilestone(
        policy,
        binding,
        renderMilestone(pending.projection, marker),
        marker,
        credentials,
        dependencies,
      );
      activePending = await acknowledgeTrackerEffect(
        root,
        activePending,
        { key: commentKey, kind: "comment", remoteId: commentId, at: now(dependencies) },
      );
    }
    for (const artifact of pending.projection.artifacts ?? []) {
      const artifactKey = trackerEffectKey(policy, pending.projection, "artifact", artifact.digest);
      if (hasTrackerEffect(activePending, artifactKey)) continue;
      const remoteId = await publishRemoteArtifact(
        root,
        policy,
        binding,
        artifact,
        artifactKey,
        credentials,
        dependencies,
      );
      activePending = await acknowledgeTrackerEffect(
        root,
        activePending,
        { key: artifactKey, kind: "artifact", remoteId, at: now(dependencies) },
      );
    }
  }
  return { remote, pending: activePending };
}

async function transitionRemoteTicketV2(
  policy: TrackerPolicy,
  binding: TrackerBinding,
  projection: TrackerProjection,
  credentials: ResolvedTrackerAuthentication,
  dependencies: TrackerDependencies,
): Promise<RemoteTicket> {
  if (policy.provider === "github") {
    const token = accessTokenFor(credentials, "github");
    const current = await attachGitHubTicket(policy, binding.remoteKey, token, dependencies);
    assertRemoteIdentity(binding, current);
    let projectItemId = await findGitHubProjectItem(policy, binding.remoteId, token, dependencies);
    if (!projectItemId) {
      const added = await githubGraphql(
        `mutation Add($project: ID!, $content: ID!, $client: String!) {
          addProjectV2ItemById(input: {projectId: $project, contentId: $content, clientMutationId: $client}) {
            item { id }
          }
        }`,
        { project: policy.target.projectId, content: binding.remoteId, client: idempotencyLabel(projection) },
        token,
        dependencies,
      );
      projectItemId = nestedString(added, ["addProjectV2ItemById", "item", "id"], "GitHub project item id");
    }
    await githubGraphql(
      `mutation Move($project: ID!, $item: ID!, $field: ID!, $option: String!, $client: String!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $project, itemId: $item, fieldId: $field,
          value: {singleSelectOptionId: $option}, clientMutationId: $client
        }) { projectV2Item { id } }
      }`,
      {
        project: policy.target.projectId,
        item: projectItemId,
        field: policy.target.statusFieldId,
        option: policy.states[projection.progress],
        client: idempotencyLabel(projection),
      },
      token,
      dependencies,
    );
    return { ...binding, projectItemId };
  }
  if (policy.provider === "linear") {
    const accessToken = linearAuthorizationFor(credentials);
    const current = await linearGraphql(
      `query Issue($id: String!) { issue(id: $id) { id identifier url team { id } project { id } } }`,
      { id: binding.remoteId },
      accessToken,
      dependencies,
    );
    const currentTicket = parseLinearIssue(policy, current.issue);
    assertRemoteIdentity(binding, currentTicket);
    const updated = await linearGraphql(
      `mutation Update($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) { success issue { id identifier url team { id } project { id } } }
      }`,
      { id: binding.remoteId, input: { stateId: policy.states[projection.progress] } },
      accessToken,
      dependencies,
    );
    const update = record(updated.issueUpdate, "Linear issueUpdate");
    if (update.success !== true) throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", "Linear did not confirm issue update");
    return parseLinearIssue(policy, update.issue);
  }
  const jira = jiraRequestContext(policy.target.siteUrl, credentials);
  const issue = await requestJson(dependencies, {
    method: "GET",
    url: `${jira.apiOrigin}/rest/api/3/issue/${encodeURIComponent(binding.remoteKey)}?fields=status,project,issuetype`,
    headers: jira.headers,
  }, [200], jira.secrets);
  const issueRecord = record(issue, "Jira issue");
  const currentTicket = parseJiraIssue(policy, issueRecord, true);
  assertRemoteIdentity(binding, currentTicket);
  await requestJson(dependencies, {
    method: "PUT",
    url: `${jira.apiOrigin}/rest/api/3/issue/${encodeURIComponent(binding.remoteKey)}/properties/empirical-sdd`,
    headers: jira.headers,
    body: JSON.stringify({ projection }),
  }, [200, 201, 204], jira.secrets);
  const desired = policy.states[projection.progress];
  if (nestedOptionalString(issueRecord, ["fields", "status", "id"]) !== desired) {
    const available = record(await requestJson(dependencies, {
      method: "GET",
      url: `${jira.apiOrigin}/rest/api/3/issue/${encodeURIComponent(binding.remoteKey)}/transitions`,
      headers: jira.headers,
    }, [200], jira.secrets), "Jira transitions");
    if (!Array.isArray(available.transitions)) throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", "Jira transitions are missing");
    const selected = available.transitions.map((entry) => record(entry, "Jira transition"))
      .find((entry) => nestedOptionalString(entry, ["to", "id"]) === desired);
    if (!selected) throw new EmpiricalError("TRACKER_STATE_UNAVAILABLE", `Jira exposes no transition to configured status ${desired}`);
    await requestJson(dependencies, {
      method: "POST",
      url: `${jira.apiOrigin}/rest/api/3/issue/${encodeURIComponent(binding.remoteKey)}/transitions`,
      headers: jira.headers,
      body: JSON.stringify({ transition: { id: requiredString(selected, "id", "Jira transition id") } }),
    }, [204], jira.secrets);
  }
  return { ...binding, url: `${jiraOrigin(policy)}/browse/${encodeURIComponent(binding.remoteKey)}` };
}

async function publishRemoteMilestone(
  policy: TrackerPolicy,
  binding: TrackerBinding,
  body: string,
  marker: string,
  credentials: ResolvedTrackerAuthentication,
  dependencies: TrackerDependencies,
): Promise<string> {
  if (policy.provider === "github") {
    const token = accessTokenFor(credentials, "github");
    const found: string[] = [];
    let complete = false;
    for (let page = 1; page <= TRACKER_DISCOVERY_LIMIT; page += 1) {
      const comments = await requestJson(dependencies, {
        method: "GET",
        url: `https://api.github.com/repos/${encodeURIComponent(policy.target.owner)}/${encodeURIComponent(policy.target.repository)}/issues/${encodeURIComponent(binding.remoteKey)}/comments?per_page=100&page=${page}`,
        headers: githubHeaders(token),
      }, [200], [token]);
      if (!Array.isArray(comments)) throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", "GitHub milestone comments are malformed");
      const matches = comments.map((entry) => record(entry, "GitHub milestone comment"))
        .filter((comment) => typeof comment.body === "string" && comment.body.includes(marker));
      found.push(...matches.map((comment) => String(requiredNumber(comment, "id", "GitHub milestone comment id"))));
      if (comments.length < 100) {
        complete = true;
        break;
      }
    }
    if (!complete) throw new EmpiricalError("TRACKER_RECONCILIATION_LIMIT", "GitHub milestone lookup exceeded 10,000 comments");
    if (found.length > 1) throw new EmpiricalError("TRACKER_MARKER_AMBIGUOUS", "Multiple GitHub comments contain one milestone marker");
    if (found[0]) return found[0];
    const created = await requestJson(dependencies, {
      method: "POST",
      url: `https://api.github.com/repos/${encodeURIComponent(policy.target.owner)}/${encodeURIComponent(policy.target.repository)}/issues/${encodeURIComponent(binding.remoteKey)}/comments`,
      headers: githubHeaders(token),
      body: JSON.stringify({ body }),
    }, [201], [token]);
    return String(requiredNumber(created, "id", "GitHub milestone comment id"));
  }
  if (policy.provider === "linear") {
    const accessToken = linearAuthorizationFor(credentials);
    let after: string | null = null;
    const cursors = new Set<string>();
    const found: string[] = [];
    let complete = false;
    for (let page = 0; page < TRACKER_DISCOVERY_LIMIT; page += 1) {
      const data = await linearGraphql(
        `query Milestones($id: String!, $after: String) {
          issue(id: $id) { comments(first: 100, after: $after) { nodes { id body } pageInfo { hasNextPage endCursor } } }
        }`,
        { id: binding.remoteId, after },
        accessToken,
        dependencies,
      );
      const issue = record(data.issue, "Linear milestone issue");
      const comments = connection(issue.comments, "Linear milestone comments");
      const matches = comments.nodes.map((entry) => record(entry, "Linear milestone comment"))
        .filter((comment) => typeof comment.body === "string" && comment.body.includes(marker));
      found.push(...matches.map((comment) => requiredString(comment, "id", "Linear milestone comment id")));
      if (!comments.hasNextPage) {
        complete = true;
        break;
      }
      after = nextDiscoveryCursor(comments.endCursor, cursors, "Linear milestone comments");
    }
    if (!complete) throw new EmpiricalError("TRACKER_RECONCILIATION_LIMIT", "Linear milestone lookup exceeded 10,000 comments");
    if (found.length > 1) throw new EmpiricalError("TRACKER_MARKER_AMBIGUOUS", "Multiple Linear comments contain one milestone marker");
    if (found[0]) return found[0];
    const data = await linearGraphql(
      `mutation Milestone($input: CommentCreateInput!) {
        commentCreate(input: $input) { success comment { id body } }
      }`,
      { input: { issueId: binding.remoteId, body } },
      accessToken,
      dependencies,
    );
    const create = record(data.commentCreate, "Linear commentCreate");
    if (create.success !== true) throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", "Linear did not confirm milestone comment creation");
    return requiredString(record(create.comment, "Linear milestone comment"), "id", "Linear milestone comment id");
  }
  const jira = jiraRequestContext(policy.target.siteUrl, credentials);
  let startAt = 0;
  const found: string[] = [];
  let complete = false;
  for (let page = 0; page < TRACKER_DISCOVERY_LIMIT; page += 1) {
    const response = record(await requestJson(dependencies, {
      method: "GET",
      url: `${jira.apiOrigin}/rest/api/3/issue/${encodeURIComponent(binding.remoteKey)}/comment?startAt=${startAt}&maxResults=100`,
      headers: jira.headers,
    }, [200], jira.secrets), "Jira milestone comments");
    if (!Array.isArray(response.comments)) throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", "Jira milestone comments are malformed");
    const matches = response.comments.map((entry) => record(entry, "Jira milestone comment"))
      .filter((comment) => JSON.stringify(comment.body ?? {}).includes(marker));
    found.push(...matches.map((comment) => requiredString(comment, "id", "Jira milestone comment id")));
    const total = optionalFiniteNumber(response.total) ?? response.comments.length;
    if (startAt + response.comments.length >= total) {
      complete = true;
      break;
    }
    if (response.comments.length === 0) throw new EmpiricalError("TRACKER_RECONCILIATION_INCOMPLETE", "Jira milestone pagination did not advance");
    startAt += response.comments.length;
  }
  if (!complete) throw new EmpiricalError("TRACKER_RECONCILIATION_LIMIT", "Jira milestone lookup exceeded 10,000 comments");
  if (found.length > 1) throw new EmpiricalError("TRACKER_MARKER_AMBIGUOUS", "Multiple Jira comments contain one milestone marker");
  if (found[0]) return found[0];
  const created = record(await requestJson(dependencies, {
    method: "POST",
    url: `${jira.apiOrigin}/rest/api/3/issue/${encodeURIComponent(binding.remoteKey)}/comment`,
    headers: jira.headers,
    body: JSON.stringify({ body: jiraAdf(body), properties: [{ key: "empirical-sdd-effect", value: marker }] }),
  }, [201], jira.secrets), "Jira milestone comment");
  return requiredString(created, "id", "Jira milestone comment id");
}

async function publishRemoteArtifact(
  root: string,
  policy: TrackerPolicy,
  binding: TrackerBinding,
  artifact: TrackerArtifact,
  effectKey: string,
  credentials: ResolvedTrackerAuthentication,
  dependencies: TrackerDependencies,
): Promise<string | null> {
  if (artifact.url) return artifact.url;
  if (policy.provider !== "jira") return null;
  const jira = jiraRequestContext(policy.target.siteUrl, credentials);
  const filename = trackerArtifactFilename(artifact, effectKey);
  const issue = record(await requestJson(dependencies, {
    method: "GET",
    url: `${jira.apiOrigin}/rest/api/3/issue/${encodeURIComponent(binding.remoteKey)}?fields=attachment,project,issuetype`,
    headers: jira.headers,
  }, [200], jira.secrets), "Jira artifact issue");
  assertRemoteIdentity(binding, parseJiraIssue(policy, issue, true));
  const fields = record(issue.fields, "Jira artifact fields");
  if (!Array.isArray(fields.attachment)) {
    throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", "Jira attachment discovery is malformed");
  }
  const existing = fields.attachment.map((entry) => record(entry, "Jira attachment"))
    .filter((entry) => entry.filename === filename);
  if (existing.length > 1) {
    throw new EmpiricalError("TRACKER_MARKER_AMBIGUOUS", "Multiple Jira attachments contain one Empirical artifact marker");
  }
  if (existing[0]) {
    assertJiraArtifact(existing[0], artifact, filename);
    return requiredString(existing[0], "id", "Jira attachment id");
  }
  const bytes = await readTrackerArtifactBytes(root, artifact);
  const multipart = trackerArtifactMultipart(filename, artifact.mediaType, bytes, effectKey);
  const response = await requestJson(dependencies, {
    method: "POST",
    url: `${jira.apiOrigin}/rest/api/3/issue/${encodeURIComponent(binding.remoteKey)}/attachments`,
    headers: {
      ...jira.headers,
      "Content-Type": multipart.contentType,
      "X-Atlassian-Token": "no-check",
    },
    body: multipart.body,
  }, [200, 201], jira.secrets);
  if (!Array.isArray(response)) {
    throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", "Jira attachment upload response is malformed");
  }
  const uploaded = response.map((entry) => record(entry, "Jira uploaded attachment"))
    .filter((entry) => entry.filename === filename);
  if (uploaded.length !== 1) {
    throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", "Jira did not return exactly one matching uploaded attachment");
  }
  assertJiraArtifact(uploaded[0]!, artifact, filename);
  return requiredString(uploaded[0]!, "id", "Jira uploaded attachment id");
}

async function readTrackerArtifactBytes(root: string, artifact: TrackerArtifact): Promise<Buffer> {
  const canonicalRoot = await realpath(resolve(root));
  const absolute = resolve(canonicalRoot, artifact.path);
  const contained = relative(canonicalRoot, absolute);
  if (contained === ".." || contained.startsWith("../") || contained.startsWith("..\\")) {
    throw new EmpiricalError("TRACKER_ARTIFACT_UNSAFE", "An evidence artifact escapes the repository before upload");
  }
  const metadata = await lstat(absolute).catch(() => null);
  if (!metadata || metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new EmpiricalError("TRACKER_ARTIFACT_UNSAFE", "An evidence artifact is missing or unsafe before upload");
  }
  const resolvedArtifact = await realpath(absolute);
  const resolvedRelative = relative(canonicalRoot, resolvedArtifact);
  if (resolvedRelative === ".." || resolvedRelative.startsWith("../") || resolvedRelative.startsWith("..\\")) {
    throw new EmpiricalError("TRACKER_ARTIFACT_UNSAFE", "An evidence artifact resolves outside the repository before upload");
  }
  const bytes = await readFile(resolvedArtifact);
  if (bytes.byteLength !== artifact.size || sha256(bytes) !== artifact.digest) {
    throw new EmpiricalError("TRACKER_ARTIFACT_UNSAFE", "An evidence artifact changed before provider upload");
  }
  return bytes;
}

function trackerArtifactFilename(artifact: TrackerArtifact, effectKey: string): string {
  const original = artifact.path.split("/").at(-1) ?? "evidence";
  const safe = original.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(-80) || "evidence";
  return `empirical-${effectKey.slice("sha256:".length, "sha256:".length + 16)}-${safe}`;
}

function trackerArtifactMultipart(
  filename: string,
  mediaType: string,
  bytes: Buffer,
  effectKey: string,
): { body: Uint8Array; contentType: string } {
  const boundary = `empirical-${effectKey.slice("sha256:".length, "sha256:".length + 32)}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mediaType}\r\n\r\n`,
    "utf8",
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  return {
    body: Buffer.concat([head, bytes, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function assertJiraArtifact(
  value: Record<string, unknown>,
  artifact: TrackerArtifact,
  filename: string,
): void {
  const size = optionalFiniteNumber(value.size);
  const mediaType = optionalString(value, "mimeType");
  if (
    value.filename !== filename
    || (size !== null && size !== artifact.size)
    || (mediaType !== null && mediaType !== artifact.mediaType)
  ) {
    throw new EmpiricalError("TRACKER_MARKER_AMBIGUOUS", "Jira attachment marker belongs to different artifact bytes");
  }
}

function shouldPublishMilestone(
  policy: TrackerPolicy,
  binding: TrackerBinding,
  projection: TrackerProjection,
): boolean {
  if (policy.schemaVersion !== TRACKER_SCHEMA_VERSION) return false;
  if (policy.visibility === "revisions") return true;
  const stopped = projection.status === "blocked" || projection.status === "awaiting_human";
  const final = projection.phase === "done" || projection.status === "done";
  if (policy.visibility === "blockers-final") return stopped || final;
  return binding.lastSyncedPhase === null
    || binding.lastSyncedPhase === undefined
    || binding.lastSyncedPhase !== projection.phase
    || binding.lastSyncedStatus !== projection.status
    || binding.lastSyncedCompletionLevel !== projection.completionLevel
    || stopped
    || final;
}

function trackerEffectKey(
  policy: TrackerPolicy,
  projection: TrackerProjection,
  kind: "transition" | "comment" | "artifact",
  artifactDigest: string | null = null,
): string {
  return digestJson({
    provider: policy.provider,
    target: trackerTargetDigest(policy),
    feature: projection.feature,
    revision: projection.revision,
    receiptDigest: projection.receiptDigest ?? digestJson([]),
    kind,
    artifactDigest,
  });
}

function milestoneMarker(key: string): string {
  return `[Empirical milestone](<${LINEAR_MARKER_ORIGIN}#empirical-milestone:${key}>)`;
}

function renderMilestone(projection: TrackerProjection, marker: string): string {
  const clean = (value: string | null | undefined) => value
    ?.replace(/<!--|-->/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const summary = clean(projection.summary);
  const blocker = clean(projection.blocker);
  const artifacts = projection.artifacts ?? [];
  return [
    `## Empirical milestone · ${readableTrackerToken(projection.phase)}`,
    marker,
    `- Feature: ${projection.feature}`,
    `- Revision: ${projection.revision}`,
    `- Progress: ${readableTrackerToken(projection.progress)}`,
    `- Completion: ${readableCompletionLevel(projection.completionLevel)}`,
    ...(summary ? [`- Summary: ${summary}`] : []),
    ...(blocker ? [`- Blocker: ${blocker}`] : []),
    ...(artifacts.length ? ["- Reviewable artifacts:", ...artifacts.map((artifact) =>
      artifact.url
        ? `  - ${artifact.path} · ${artifact.receiptId} · ${artifact.url}`
        : `  - ${artifact.path} · ${artifact.receiptId} · provider upload/link pending or unsupported`)] : []),
  ].join("\n");
}

function hasTrackerEffect(pending: TrackerPendingRecord, key: string): boolean {
  return (pending.effects ?? []).some((effect) => effect.key === key);
}

async function acknowledgeTrackerEffect(
  root: string,
  pending: TrackerPendingRecord,
  effect: NonNullable<TrackerPendingRecord["effects"]>[number],
): Promise<TrackerPendingRecord> {
  if (pending.schemaVersion !== TRACKER_SCHEMA_VERSION) return pending;
  const effects = [...(pending.effects ?? []).filter((entry) => entry.key !== effect.key), effect]
    .slice(-100);
  const acknowledged = createPendingRecord({ ...pending, effects });
  await writeTrackerPending(root, acknowledged);
  return acknowledged;
}

async function createGitHubTicket(
  policy: GitHubTrackerPolicy,
  intent: Extract<TrackerBindIntent, { mode: "create" }>,
  idempotencyKey: string,
  token: string,
  dependencies: TrackerDependencies,
): Promise<RemoteTicket> {
  const issue = await requestJson(
    dependencies,
    {
      method: "POST",
      url: `https://api.github.com/repos/${encodeURIComponent(policy.target.owner)}/${encodeURIComponent(policy.target.repository)}/issues`,
      headers: githubHeaders(token),
      body: JSON.stringify({
        title: intent.title,
        body: appendCreateMarker(intent.description, intent, idempotencyKey),
      }),
    },
    [201],
    [token],
  );
  return parseGitHubIssue(policy, issue);
}

async function attachGitHubTicket(
  policy: GitHubTrackerPolicy,
  ticket: string,
  token: string,
  dependencies: TrackerDependencies,
): Promise<RemoteTicket> {
  if (!/^\d+$/.test(ticket)) throw new EmpiricalError("INVALID_TRACKER_TICKET", "GitHub attachment requires an issue number");
  const issue = await requestJson(
    dependencies,
    {
      method: "GET",
      url: `https://api.github.com/repos/${encodeURIComponent(policy.target.owner)}/${encodeURIComponent(policy.target.repository)}/issues/${ticket}`,
      headers: githubHeaders(token),
    },
    [200],
    [token],
  );
  const parsed = parseGitHubIssue(policy, issue);
  if (parsed.remoteKey !== ticket) throw new EmpiricalError("TRACKER_IDENTITY_MISMATCH", "GitHub returned a different issue than requested");
  return parsed;
}

async function syncGitHubTicket(
  policy: GitHubTrackerPolicy,
  binding: TrackerBinding,
  projection: TrackerProjection,
  token: string,
  dependencies: TrackerDependencies,
): Promise<RemoteTicket> {
  const current = await attachGitHubTicket(policy, binding.remoteKey, token, dependencies);
  assertRemoteIdentity(binding, current);
  let projectItemId = await findGitHubProjectItem(policy, binding.remoteId, token, dependencies);
  if (!projectItemId) {
    const added = await githubGraphql(
      `mutation Add($project: ID!, $content: ID!, $client: String!) {
        addProjectV2ItemById(input: {projectId: $project, contentId: $content, clientMutationId: $client}) {
          item { id }
        }
      }`,
      { project: policy.target.projectId, content: binding.remoteId, client: idempotencyLabel(projection) },
      token,
      dependencies,
    );
    projectItemId = nestedString(added, ["addProjectV2ItemById", "item", "id"], "GitHub project item id");
  }
  let markerId = await findGitHubMarkerComment(policy, binding.remoteKey, projection.feature, token, dependencies);
  const comment = renderProjection(projection);
  if (markerId) {
    await requestJson(
      dependencies,
      {
        method: "PATCH",
        url: `https://api.github.com/repos/${encodeURIComponent(policy.target.owner)}/${encodeURIComponent(policy.target.repository)}/issues/comments/${encodeURIComponent(markerId)}`,
        headers: githubHeaders(token),
        body: JSON.stringify({ body: comment }),
      },
      [200],
      [token],
    );
  } else {
    const created = await requestJson(
      dependencies,
      {
        method: "POST",
        url: `https://api.github.com/repos/${encodeURIComponent(policy.target.owner)}/${encodeURIComponent(policy.target.repository)}/issues/${encodeURIComponent(binding.remoteKey)}/comments`,
        headers: githubHeaders(token),
        body: JSON.stringify({ body: comment }),
      },
      [201],
      [token],
    );
    markerId = String(requiredNumber(created, "id", "GitHub comment id"));
  }
  await githubGraphql(
    `mutation Move($project: ID!, $item: ID!, $field: ID!, $option: String!, $client: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $project, itemId: $item, fieldId: $field,
        value: {singleSelectOptionId: $option}, clientMutationId: $client
      }) { projectV2Item { id } }
    }`,
    {
      project: policy.target.projectId,
      item: projectItemId,
      field: policy.target.statusFieldId,
      option: policy.states[projection.progress],
      client: idempotencyLabel(projection),
    },
    token,
    dependencies,
  );
  return { ...binding, projectItemId, markerId };
}

async function findGitHubMarkerComment(
  policy: GitHubTrackerPolicy,
  issueNumber: string,
  feature: string,
  token: string,
  dependencies: TrackerDependencies,
): Promise<string | null> {
  const marker = `<!-- empirical-sdd:${feature}:start -->`;
  const endMarker = `<!-- empirical-sdd:${feature}:end -->`;
  let match: string | null = null;
  for (let page = 1; page <= 100; page += 1) {
    const response = await requestJson(
      dependencies,
      {
        method: "GET",
        url: `https://api.github.com/repos/${encodeURIComponent(policy.target.owner)}/${encodeURIComponent(policy.target.repository)}/issues/${encodeURIComponent(issueNumber)}/comments?per_page=100&page=${page}`,
        headers: githubHeaders(token),
      },
      [200],
      [token],
    );
    if (!Array.isArray(response)) {
      throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", "GitHub issue comments are missing or malformed");
    }
    for (const rawComment of response) {
      const candidate = record(rawComment, "GitHub issue comment");
      if (typeof candidate.body === "string" && isExactOwnedMarkerBlock(candidate.body, marker, endMarker)) {
        if (match !== null) {
          throw new EmpiricalError("TRACKER_MARKER_AMBIGUOUS", "Multiple GitHub comments contain an exact Empirical-owned marker block");
        }
        match = String(requiredNumber(candidate, "id", "GitHub comment id"));
      }
    }
    if (response.length < 100) return match;
  }
  throw new EmpiricalError("TRACKER_COMMENT_LOOKUP_LIMIT", "GitHub marker lookup exceeded 10,000 comments");
}

async function findGitHubProjectItem(
  policy: GitHubTrackerPolicy,
  contentId: string,
  token: string,
  dependencies: TrackerDependencies,
): Promise<string | null> {
  let after: string | null = null;
  for (let page = 0; page < 100; page += 1) {
    const data = await githubGraphql(
      `query ExistingItem($content: ID!, $after: String) {
        node(id: $content) {
          ... on Issue {
            projectItems(first: 100, after: $after, includeArchived: false) {
              nodes { id project { id } }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
      }`,
      { content: contentId, after },
      token,
      dependencies,
    );
    const connection = record(record(data.node, "GitHub issue node").projectItems, "GitHub project items");
    if (!Array.isArray(connection.nodes)) {
      throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", "GitHub project item nodes are missing");
    }
    for (const rawItem of connection.nodes) {
      const item = record(rawItem, "GitHub project item");
      const project = record(item.project, "GitHub project item project");
      if (requiredString(project, "id", "GitHub project id") === policy.target.projectId) {
        return requiredString(item, "id", "GitHub project item id");
      }
    }
    const pageInfo = record(connection.pageInfo ?? {}, "GitHub project item page info");
    if (typeof pageInfo.hasNextPage !== "boolean") {
      throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", "GitHub project item pagination is malformed");
    }
    if (!pageInfo.hasNextPage) return null;
    after = requiredString(pageInfo, "endCursor", "GitHub project item cursor");
  }
  throw new EmpiricalError("TRACKER_PROJECT_LOOKUP_LIMIT", "GitHub project item lookup exceeded 10,000 items");
}

async function githubGraphql(
  query: string,
  variables: Record<string, unknown>,
  token: string,
  dependencies: TrackerDependencies,
): Promise<Record<string, unknown>> {
  const response = await requestJson(
    dependencies,
    {
      method: "POST",
      url: "https://api.github.com/graphql",
      headers: githubHeaders(token),
      body: JSON.stringify({ query, variables }),
    },
    [200],
    [token],
  );
  return graphqlData(response, "GitHub");
}

function githubHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "empirical-sdd",
    "X-GitHub-Api-Version": "2026-03-10",
  };
}

function parseGitHubIssue(policy: GitHubTrackerPolicy, value: unknown): RemoteTicket {
  const issue = record(value, "GitHub issue");
  if (issue.pull_request !== undefined) {
    throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", "GitHub attachment must refer to an issue, not a pull request");
  }
  const remoteId = requiredString(issue, "node_id", "GitHub issue node id");
  const remoteKey = String(requiredNumber(issue, "number", "GitHub issue number"));
  const url = validateProviderUrl(requiredUrlString(issue, "html_url", "GitHub issue URL"), "github.com");
  const expectedPath = `/${policy.target.owner}/${policy.target.repository}/issues/${remoteKey}`.toLowerCase();
  if (new URL(url).pathname.toLowerCase() !== expectedPath) {
    throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", "GitHub returned an issue URL outside the configured repository");
  }
  return { remoteId, remoteKey, url, projectItemId: null, markerId: null };
}

async function createLinearTicket(
  policy: LinearTrackerPolicy,
  projection: TrackerProjection,
  intent: Extract<TrackerBindIntent, { mode: "create" }>,
  idempotencyKey: string,
  authorization: string,
  dependencies: TrackerDependencies,
): Promise<RemoteTicket> {
  const data = await linearGraphql(
    `mutation Create($input: IssueCreateInput!) {
      issueCreate(input: $input) { success issue { id identifier url team { id } project { id } } }
    }`,
    {
      input: {
        title: intent.title,
        description: appendLinearCreateMarker(
          policy.schemaVersion === TRACKER_SCHEMA_VERSION
            ? intent.description
            : upsertLinearMarkerBlock(intent.description, projection),
          intent,
          idempotencyKey,
        ),
        teamId: policy.target.teamId,
        ...(policy.target.projectId ? { projectId: policy.target.projectId } : {}),
        stateId: policy.states[projection.progress],
      },
    },
    authorization,
    dependencies,
  );
  const create = record(data.issueCreate, "Linear issueCreate");
  if (create.success !== true) throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", "Linear did not confirm issue creation");
  return parseLinearIssue(policy, create.issue);
}

async function attachLinearTicket(
  policy: LinearTrackerPolicy,
  ticket: string,
  authorization: string,
  dependencies: TrackerDependencies,
): Promise<RemoteTicket> {
  const data = await linearGraphql(
    `query Issue($id: String!) { issue(id: $id) { id identifier url team { id } project { id } } }`,
    { id: ticket },
    authorization,
    dependencies,
  );
  const parsed = parseLinearIssue(policy, data.issue);
  if (ticket !== parsed.remoteId && ticket !== parsed.remoteKey) {
    throw new EmpiricalError("TRACKER_IDENTITY_MISMATCH", "Linear returned a different issue than requested");
  }
  return parsed;
}

async function syncLinearTicket(
  policy: LinearTrackerPolicy,
  binding: TrackerBinding,
  projection: TrackerProjection,
  authorization: string,
  dependencies: TrackerDependencies,
): Promise<RemoteTicket> {
  const current = await linearGraphql(
    `query Issue($id: String!) { issue(id: $id) { id identifier url description team { id } project { id } } }`,
    { id: binding.remoteId },
    authorization,
    dependencies,
  );
  const issue = record(current.issue, "Linear issue");
  const currentTicket = parseLinearIssue(policy, issue);
  assertRemoteIdentity(binding, currentTicket);
  const description = typeof issue.description === "string" ? issue.description : "";
  const migratedDescription = migrateLinearCreateMarker(description, projection.feature);
  const updated = await linearGraphql(
    `mutation Update($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) { success issue { id identifier url team { id } project { id } } }
    }`,
    {
      id: binding.remoteId,
      input: {
        description: upsertLinearMarkerBlock(migratedDescription, projection),
        stateId: policy.states[projection.progress],
      },
    },
    authorization,
    dependencies,
  );
  const update = record(updated.issueUpdate, "Linear issueUpdate");
  if (update.success !== true) throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", "Linear did not confirm issue update");
  return { ...parseLinearIssue(policy, update.issue), projectItemId: null, markerId: null };
}

async function linearGraphql(
  query: string,
  variables: Record<string, unknown>,
  authorization: string,
  dependencies: TrackerDependencies,
): Promise<Record<string, unknown>> {
  const secrets = authorization.startsWith("Bearer ")
    ? [authorization, authorization.slice("Bearer ".length)]
    : [authorization];
  const response = await requestJson(
    dependencies,
    {
      method: "POST",
      url: "https://api.linear.app/graphql",
      headers: { Authorization: authorization, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    },
    [200],
    secrets,
  );
  return graphqlData(response, "Linear");
}

function parseLinearIssue(policy: LinearTrackerPolicy, value: unknown): RemoteTicket {
  const issue = record(value, "Linear issue");
  const remoteKey = requiredString(issue, "identifier", "Linear issue identifier");
  const url = validateProviderUrl(requiredUrlString(issue, "url", "Linear issue URL"), "linear.app");
  const segments = new URL(url).pathname.split("/").filter(Boolean);
  const issueIndex = segments.indexOf("issue");
  if (issueIndex < 0 || segments[issueIndex + 1] !== remoteKey) {
    throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", "Linear returned an issue URL with a mismatched identifier");
  }
  const teamId = nestedOptionalString(issue, ["team", "id"]);
  const projectId = nestedOptionalString(issue, ["project", "id"]);
  if (teamId !== policy.target.teamId || (policy.target.projectId !== null && projectId !== policy.target.projectId)) {
    throw new EmpiricalError("TRACKER_TARGET_MISMATCH", "Linear issue is outside the configured team or project");
  }
  return {
    remoteId: requiredString(issue, "id", "Linear issue id"),
    remoteKey,
    url,
    projectItemId: null,
    markerId: null,
  };
}

async function createJiraTicket(
  policy: JiraTrackerPolicy,
  projection: TrackerProjection,
  intent: Extract<TrackerBindIntent, { mode: "create" }>,
  idempotencyKey: string,
  authentication: ResolvedTrackerAuthentication,
  dependencies: TrackerDependencies,
): Promise<RemoteTicket> {
  const jira = jiraRequestContext(policy.target.siteUrl, authentication);
  const issue = await requestJson(
    dependencies,
    {
      method: "POST",
      url: `${jira.apiOrigin}/rest/api/3/issue`,
      headers: jira.headers,
      body: JSON.stringify({
        fields: {
          project: { key: policy.target.projectKey },
          issuetype: { id: policy.target.issueTypeId },
          summary: intent.title,
          description: jiraAdf(intent.description),
        },
        properties: [{
          key: "empirical-sdd",
          value: { projection, create: { marker: intent.marker, idempotencyKey } },
        }],
      }),
    },
    [201],
    jira.secrets,
  );
  return parseJiraIssue(policy, issue);
}

async function attachJiraTicket(
  policy: JiraTrackerPolicy,
  ticket: string,
  authentication: ResolvedTrackerAuthentication,
  dependencies: TrackerDependencies,
): Promise<RemoteTicket> {
  const jira = jiraRequestContext(policy.target.siteUrl, authentication);
  const issue = await requestJson(
    dependencies,
    {
      method: "GET",
      url: `${jira.apiOrigin}/rest/api/3/issue/${encodeURIComponent(ticket)}?fields=status,project,issuetype`,
      headers: jira.headers,
    },
    [200],
    jira.secrets,
  );
  const parsed = parseJiraIssue(policy, issue, true);
  if (ticket !== parsed.remoteId && ticket !== parsed.remoteKey) {
    throw new EmpiricalError("TRACKER_IDENTITY_MISMATCH", "Jira returned a different issue than requested");
  }
  return parsed;
}

async function syncJiraTicket(
  policy: JiraTrackerPolicy,
  binding: TrackerBinding,
  projection: TrackerProjection,
  authentication: ResolvedTrackerAuthentication,
  dependencies: TrackerDependencies,
): Promise<RemoteTicket> {
  const jira = jiraRequestContext(policy.target.siteUrl, authentication);
  const issue = await requestJson(
    dependencies,
    {
      method: "GET",
      url: `${jira.apiOrigin}/rest/api/3/issue/${encodeURIComponent(binding.remoteKey)}?fields=status,project,issuetype`,
      headers: jira.headers,
    },
    [200],
    jira.secrets,
  );
  const issueRecord = record(issue, "Jira issue");
  const currentTicket = parseJiraIssue(policy, issueRecord, true);
  assertRemoteIdentity(binding, currentTicket);
  await requestJson(
    dependencies,
    {
      method: "PUT",
      url: `${jira.apiOrigin}/rest/api/3/issue/${encodeURIComponent(binding.remoteKey)}/properties/empirical-sdd`,
      headers: jira.headers,
      body: JSON.stringify(projection),
    },
    [200, 201, 204],
    jira.secrets,
  );
  const desired = policy.states[projection.progress];
  const currentStatus = nestedOptionalString(issueRecord, ["fields", "status", "id"]);
  if (currentStatus !== desired) {
    const available = await requestJson(
      dependencies,
      {
        method: "GET",
        url: `${jira.apiOrigin}/rest/api/3/issue/${encodeURIComponent(binding.remoteKey)}/transitions`,
        headers: jira.headers,
      },
      [200],
      jira.secrets,
    );
    const transitions = record(available, "Jira transitions").transitions;
    if (!Array.isArray(transitions)) throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", "Jira transitions are missing");
    const selected = transitions
      .map((entry) => record(entry, "Jira transition"))
      .find((entry) => nestedOptionalString(entry, ["to", "id"]) === desired);
    if (!selected) {
      throw new EmpiricalError("TRACKER_STATE_UNAVAILABLE", `Jira exposes no transition to configured status ${desired}`);
    }
    await requestJson(
      dependencies,
      {
        method: "POST",
        url: `${jira.apiOrigin}/rest/api/3/issue/${encodeURIComponent(binding.remoteKey)}/transitions`,
        headers: jira.headers,
        body: JSON.stringify({ transition: { id: requiredString(selected, "id", "Jira transition id") } }),
      },
      [204],
      jira.secrets,
    );
  }
  return { ...binding, url: `${jiraOrigin(policy)}/browse/${encodeURIComponent(binding.remoteKey)}` };
}

interface JiraRequestContext {
  apiOrigin: string;
  headers: Record<string, string>;
  secrets: string[];
}

function jiraRequestContext(
  siteUrl: string,
  authentication: ResolvedTrackerAuthentication,
): JiraRequestContext {
  if (authentication.provider !== "jira") {
    throw new EmpiricalError("TRACKER_AUTH_PROVIDER_MISMATCH", "Resolved tracker authentication belongs to a different provider");
  }
  if (authentication.source === "oauth") {
    return {
      apiOrigin: `https://api.atlassian.com/ex/jira/${encodeURIComponent(authentication.cloudId)}`,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${authentication.accessToken}`,
        "Content-Type": "application/json",
      },
      secrets: [authentication.accessToken],
    };
  }
  return {
    apiOrigin: new URL(siteUrl).origin,
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${authentication.email}:${authentication.apiToken}`, "utf8").toString("base64")}`,
      "Content-Type": "application/json",
    },
    secrets: [authentication.email, authentication.apiToken],
  };
}

function jiraOrigin(policy: JiraTrackerPolicy): string {
  return new URL(policy.target.siteUrl).origin;
}

function parseJiraIssue(policy: JiraTrackerPolicy, value: unknown, requireTargetFields = false): RemoteTicket {
  const issue = record(value, "Jira issue");
  const remoteId = requiredString(issue, "id", "Jira issue id");
  const remoteKey = requiredString(issue, "key", "Jira issue key");
  if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(remoteKey)) {
    throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", "Jira returned an invalid issue key");
  }
  const projectKey = nestedOptionalString(issue, ["fields", "project", "key"]);
  const issueTypeId = nestedOptionalString(issue, ["fields", "issuetype", "id"]);
  if (
    !remoteKey.startsWith(`${policy.target.projectKey}-`)
    || (requireTargetFields && (projectKey !== policy.target.projectKey || issueTypeId !== policy.target.issueTypeId))
  ) {
    throw new EmpiricalError("TRACKER_TARGET_MISMATCH", "Jira issue is outside the configured project or issue type");
  }
  return {
    remoteId,
    remoteKey,
    url: `${jiraOrigin(policy)}/browse/${encodeURIComponent(remoteKey)}`,
    projectItemId: null,
    markerId: null,
  };
}

async function discoverLinearResources(
  authorization: string,
  dependencies: TrackerDependencies,
): Promise<TrackerDiscoveryResource[]> {
  const resources: TrackerDiscoveryResource[] = [];
  let after: string | null = null;
  const cursors = new Set<string>();
  for (let page = 0; page < TRACKER_DISCOVERY_LIMIT; page += 1) {
    const data = await linearGraphql(
      `query EmpiricalTrackerDiscovery($after: String, $teamFirst: Int!) {
        organization { id name urlKey }
        teams(first: $teamFirst, after: $after) {
          nodes {
            id name key
            projects(first: 100) { nodes { id name url } pageInfo { hasNextPage endCursor } }
            states(first: 100) { nodes { id name type position } pageInfo { hasNextPage endCursor } }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { after, teamFirst: LINEAR_TEAM_DISCOVERY_PAGE_SIZE },
      authorization,
      dependencies,
    );
    const organizationValue = data.organization
      ?? (typeof data.viewer === "object" && data.viewer !== null && !Array.isArray(data.viewer)
        ? (data.viewer as Record<string, unknown>).organization
        : undefined);
    const organization = record(organizationValue, "Linear organization");
    const workspaceId = requiredString(organization, "id", "Linear workspace id");
    if (!resources.some((resource) => resource.kind === "workspace" && resource.id === workspaceId)) {
      resources.push(discoveryResource({
        kind: "workspace",
        id: workspaceId,
        name: requiredDisplayString(organization, "name", "Linear workspace name"),
        key: optionalString(organization, "urlKey"),
      }));
    }
    const teams = connection(data.teams, "Linear teams");
    for (const rawTeam of teams.nodes) {
      const team = record(rawTeam, "Linear team");
      const teamId = requiredString(team, "id", "Linear team id");
      resources.push(discoveryResource({
        kind: "team",
        id: teamId,
        name: requiredDisplayString(team, "name", "Linear team name"),
        parentId: workspaceId,
        key: optionalString(team, "key"),
      }));
      const projects = connection(team.projects, "Linear team projects");
      assertTerminalConnection(projects, "Linear project discovery");
      projects.nodes.forEach((rawProject, index) => {
        const project = record(rawProject, "Linear project");
        resources.push(discoveryResource({
          kind: "project",
          id: requiredString(project, "id", "Linear project id"),
          name: requiredDisplayString(project, "name", "Linear project name"),
          parentId: teamId,
          position: index,
          url: optionalSafeUrl(project, "url", "linear.app"),
        }));
      });
      const states = connection(team.states, "Linear workflow states");
      assertTerminalConnection(states, "Linear workflow-state discovery");
      states.nodes.forEach((rawState, index) => {
        const state = record(rawState, "Linear workflow state");
        resources.push(discoveryResource({
          kind: "state",
          id: requiredString(state, "id", "Linear workflow state id"),
          name: requiredDisplayString(state, "name", "Linear workflow state name"),
          parentId: teamId,
          position: optionalFiniteNumber(state.position) ?? index,
          stateType: requiredString(state, "type", "Linear workflow state type"),
        }));
      });
    }
    if (!teams.hasNextPage) return resources;
    after = nextDiscoveryCursor(teams.endCursor, cursors, "Linear teams");
  }
  throw new EmpiricalError("TRACKER_DISCOVERY_LIMIT", "Linear discovery exceeded the pagination limit");
}

async function discoverGitHubResources(
  token: string,
  dependencies: TrackerDependencies,
): Promise<TrackerDiscoveryResource[]> {
  const data = await githubGraphql(
    `query EmpiricalTrackerDiscovery {
      viewer {
        login url
        repositories(first: 100, affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]) {
          nodes { id name nameWithOwner url owner { id login } }
          pageInfo { hasNextPage endCursor }
        }
        projectsV2(first: 100) {
          nodes {
            id title url
            fields(first: 100) {
              nodes {
                ... on ProjectV2SingleSelectField { id name options { id name } }
              }
              pageInfo { hasNextPage endCursor }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
        organizations(first: 100) {
          nodes {
            id login name url
            projectsV2(first: 100) {
              nodes {
                id title url
                fields(first: 100) {
                  nodes {
                    ... on ProjectV2SingleSelectField { id name options { id name } }
                  }
                  pageInfo { hasNextPage endCursor }
                }
              }
              pageInfo { hasNextPage endCursor }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }`,
    {},
    token,
    dependencies,
  );
  const viewer = record(data.viewer, "GitHub viewer");
  const resources: TrackerDiscoveryResource[] = [];
  const viewerLogin = requiredString(viewer, "login", "GitHub viewer login");
  const viewerId = `github-owner:${viewerLogin.toLowerCase()}`;
  resources.push(discoveryResource({
    kind: "workspace",
    id: viewerId,
    name: viewerLogin,
    key: viewerLogin,
    url: optionalSafeUrl(viewer, "url", "github.com"),
  }));
  const repositories = connection(viewer.repositories, "GitHub repositories");
  assertTerminalConnection(repositories, "GitHub repository discovery");
  for (const rawRepository of repositories.nodes) {
    const repository = record(rawRepository, "GitHub repository");
    const owner = record(repository.owner, "GitHub repository owner");
    const ownerLogin = requiredString(owner, "login", "GitHub repository owner login");
    const ownerId = `github-owner:${ownerLogin.toLowerCase()}`;
    if (!resources.some((resource) => resource.kind === "workspace" && resource.id === ownerId)) {
      resources.push(discoveryResource({ kind: "workspace", id: ownerId, name: ownerLogin, key: ownerLogin }));
    }
    resources.push(discoveryResource({
      kind: "repository",
      id: requiredString(repository, "id", "GitHub repository id"),
      name: requiredDisplayString(repository, "name", "GitHub repository name"),
      parentId: ownerId,
      key: optionalString(repository, "nameWithOwner"),
      url: optionalSafeUrl(repository, "url", "github.com"),
    }));
  }
  addGitHubProjects(resources, connection(viewer.projectsV2, "GitHub viewer projects"), viewerId);
  const organizations = connection(viewer.organizations, "GitHub organizations");
  assertTerminalConnection(organizations, "GitHub organization discovery");
  for (const rawOrganization of organizations.nodes) {
    const organization = record(rawOrganization, "GitHub organization");
    const login = requiredString(organization, "login", "GitHub organization login");
    const ownerId = `github-owner:${login.toLowerCase()}`;
    if (!resources.some((resource) => resource.kind === "workspace" && resource.id === ownerId)) {
      resources.push(discoveryResource({
        kind: "workspace",
        id: ownerId,
        name: optionalString(organization, "name") ?? login,
        key: login,
        url: optionalSafeUrl(organization, "url", "github.com"),
      }));
    }
    addGitHubProjects(resources, connection(organization.projectsV2, "GitHub organization projects"), ownerId);
  }
  return resources;
}

function addGitHubProjects(
  resources: TrackerDiscoveryResource[],
  projects: TrackerConnection,
  ownerId: string,
): void {
  assertTerminalConnection(projects, "GitHub project discovery");
  for (const rawProject of projects.nodes) {
    const project = record(rawProject, "GitHub project");
    const projectId = requiredString(project, "id", "GitHub project id");
    resources.push(discoveryResource({
      kind: "project",
      id: projectId,
      name: requiredDisplayString(project, "title", "GitHub project title"),
      parentId: ownerId,
      url: optionalSafeUrl(project, "url", "github.com"),
    }));
    const fields = connection(project.fields, "GitHub project fields");
    assertTerminalConnection(fields, "GitHub project field discovery");
    for (const rawField of fields.nodes) {
      if (rawField === null) continue;
      const field = record(rawField, "GitHub project field");
      if (!Array.isArray(field.options)) continue;
      const fieldId = requiredString(field, "id", "GitHub project field id");
      resources.push(discoveryResource({
        kind: "field",
        id: fieldId,
        name: requiredDisplayString(field, "name", "GitHub project field name"),
        parentId: projectId,
      }));
      field.options.forEach((rawOption, index) => {
        const option = record(rawOption, "GitHub project field option");
        resources.push(discoveryResource({
          kind: "state",
          id: requiredString(option, "id", "GitHub status option id"),
          name: requiredDisplayString(option, "name", "GitHub status option name"),
          parentId: fieldId,
          position: index,
          stateType: "option",
        }));
      });
    }
  }
}

async function discoverJiraResources(
  siteUrl: string,
  authentication: ResolvedTrackerAuthentication,
  dependencies: TrackerDependencies,
): Promise<TrackerDiscoveryResource[]> {
  const origin = new URL(siteUrl).origin;
  const jira = jiraRequestContext(siteUrl, authentication);
  const resources: TrackerDiscoveryResource[] = [discoveryResource({
    kind: "workspace",
    id: origin,
    name: new URL(origin).hostname,
    key: origin,
    url: origin,
  })];
  let startAt = 0;
  for (let page = 0; page < TRACKER_DISCOVERY_LIMIT; page += 1) {
    const response = record(await requestJson(dependencies, {
      method: "GET",
      url: `${jira.apiOrigin}/rest/api/3/project/search?startAt=${startAt}&maxResults=50&orderBy=name`,
      headers: jira.headers,
    }, [200], jira.secrets), "Jira project discovery");
    if (!Array.isArray(response.values)) {
      throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", "Jira project discovery values are malformed");
    }
    for (const rawProject of response.values) {
      const project = record(rawProject, "Jira project");
      const projectId = requiredString(project, "id", "Jira project id");
      const projectKey = requiredString(project, "key", "Jira project key");
      resources.push(discoveryResource({
        kind: "project",
        id: projectKey,
        name: requiredDisplayString(project, "name", "Jira project name"),
        parentId: origin,
        key: projectKey,
        url: `${origin}/browse/${encodeURIComponent(projectKey)}`,
      }));
      const issueTypesValue = await requestJson(dependencies, {
        method: "GET",
        url: `${jira.apiOrigin}/rest/api/3/issuetype/project?projectId=${encodeURIComponent(projectId)}`,
        headers: jira.headers,
      }, [200], jira.secrets);
      if (!Array.isArray(issueTypesValue)) {
        throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", "Jira issue-type discovery is malformed");
      }
      issueTypesValue.forEach((rawIssueType, index) => {
        const issueType = record(rawIssueType, "Jira issue type");
        resources.push(discoveryResource({
          kind: "issue-type",
          id: requiredString(issueType, "id", "Jira issue type id"),
          name: requiredDisplayString(issueType, "name", "Jira issue type name"),
          parentId: projectKey,
          position: index,
        }));
      });
      const statusesValue = await requestJson(dependencies, {
        method: "GET",
        url: `${jira.apiOrigin}/rest/api/3/project/${encodeURIComponent(projectKey)}/statuses`,
        headers: jira.headers,
      }, [200], jira.secrets);
      if (!Array.isArray(statusesValue)) {
        throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", "Jira status discovery is malformed");
      }
      let statePosition = 0;
      for (const rawIssueTypeStatuses of statusesValue) {
        const issueTypeStatuses = record(rawIssueTypeStatuses, "Jira issue-type statuses");
        if (!Array.isArray(issueTypeStatuses.statuses)) {
          throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", "Jira statuses are malformed");
        }
        for (const rawStatus of issueTypeStatuses.statuses) {
          const status = record(rawStatus, "Jira status");
          const statusId = requiredString(status, "id", "Jira status id");
          if (resources.some((resource) => resource.kind === "state" && resource.id === statusId && resource.parentId === projectKey)) continue;
          resources.push(discoveryResource({
            kind: "state",
            id: statusId,
            name: requiredDisplayString(status, "name", "Jira status name"),
            parentId: projectKey,
            position: statePosition++,
            stateType: nestedOptionalString(status, ["statusCategory", "key"]) ?? "status",
          }));
        }
      }
    }
    const isLast = typeof response.isLast === "boolean"
      ? response.isLast
      : startAt + response.values.length >= optionalFiniteNumber(response.total ?? response.values.length)!;
    if (isLast) break;
    const next = optionalFiniteNumber(response.startAt) ?? startAt;
    const maxResults = optionalFiniteNumber(response.maxResults) ?? response.values.length;
    if (maxResults <= 0 || next + maxResults <= startAt) {
      throw new EmpiricalError("TRACKER_DISCOVERY_INCOMPLETE", "Jira project pagination did not advance");
    }
    startAt = next + maxResults;
    if (page === TRACKER_DISCOVERY_LIMIT - 1) {
      throw new EmpiricalError("TRACKER_DISCOVERY_LIMIT", "Jira discovery exceeded the pagination limit");
    }
  }
  const fieldsValue = await requestJson(dependencies, {
    method: "GET",
    url: `${jira.apiOrigin}/rest/api/3/field`,
    headers: jira.headers,
  }, [200], jira.secrets);
  if (!Array.isArray(fieldsValue)) {
    throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", "Jira field discovery is malformed");
  }
  fieldsValue.forEach((rawField, index) => {
    const field = record(rawField, "Jira field");
    resources.push(discoveryResource({
      kind: "field",
      id: requiredString(field, "id", "Jira field id"),
      name: requiredDisplayString(field, "name", "Jira field name"),
      parentId: origin,
      position: index,
      key: optionalString(field, "key"),
    }));
  });
  return resources;
}

async function requestJson(
  dependencies: TrackerDependencies,
  request: Omit<TrackerHttpRequest, "timeoutMs" | "maxResponseBytes">,
  expectedStatuses: number[],
  secrets: string[],
): Promise<unknown> {
  const transport = dependencies.transport ?? defaultTrackerTransport;
  let response: TrackerHttpResponse;
  try {
    response = await transport({
      ...request,
      timeoutMs: TRACKER_TIMEOUT_MS,
      maxResponseBytes: TRACKER_MAX_RESPONSE_BYTES,
    });
  } catch (error) {
    if (error instanceof EmpiricalError) {
      throw new EmpiricalError(error.code, safeDiagnostic(error.message, secrets));
    }
    throw new EmpiricalError("TRACKER_TRANSPORT_FAILED", "Tracker request did not return a response");
  }
  if (
    typeof response !== "object"
    || response === null
    || !Number.isInteger(response.status)
    || typeof response.body !== "string"
  ) {
    throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", "Tracker transport returned a malformed response envelope");
  }
  if (Buffer.byteLength(response.body, "utf8") > TRACKER_MAX_RESPONSE_BYTES) {
    throw new EmpiricalError("TRACKER_RESPONSE_TOO_LARGE", "Tracker response exceeds the configured limit");
  }
  if (!expectedStatuses.includes(response.status)) {
    throw new EmpiricalError(
      "TRACKER_HTTP_FAILED",
      `Tracker returned HTTP ${response.status}`,
    );
  }
  if (!response.body.trim()) return {};
  try {
    return JSON.parse(response.body) as unknown;
  } catch {
    throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", "Tracker returned invalid JSON");
  }
}

function graphqlData(value: unknown, provider: string): Record<string, unknown> {
  const response = record(value, `${provider} GraphQL response`);
  if (Array.isArray(response.errors) && response.errors.length > 0) {
    throw new EmpiricalError("TRACKER_GRAPHQL_FAILED", `${provider} returned GraphQL errors`);
  }
  return record(response.data, `${provider} GraphQL data`);
}

function accessTokenFor(
  authentication: ResolvedTrackerAuthentication,
  provider: "github",
): string {
  if (authentication.provider !== provider) {
    throw new EmpiricalError("TRACKER_AUTH_PROVIDER_MISMATCH", "Resolved tracker authentication belongs to a different provider");
  }
  return authentication.accessToken;
}

function linearAuthorizationFor(authentication: ResolvedTrackerAuthentication): string {
  if (authentication.provider !== "linear") {
    throw new EmpiricalError("TRACKER_AUTH_PROVIDER_MISMATCH", "Resolved tracker authentication belongs to a different provider");
  }
  return authentication.source === "oauth"
    ? `Bearer ${authentication.accessToken}`
    : authentication.accessToken;
}

function withTrackerRepositoryRoot(dependencies: TrackerDependencies, root: string): TrackerDependencies {
  return { ...dependencies, repositoryRoot: root };
}

async function persistPending(
  root: string,
  policy: TrackerPolicy,
  projection: TrackerProjection,
  intent: TrackerBindIntent,
  previous: TrackerPendingRecord | null,
  dependencies: TrackerDependencies,
  newCreateAttempt = false,
  replacesBindingDigest: string | null = previous?.replacesBindingDigest ?? null,
): Promise<TrackerPendingRecord> {
  const targetDigest = trackerTargetDigest(policy);
  const policyDigest = trackerProjectionPolicyDigest(policy);
  const reuseBindAttempt = previous?.targetDigest === targetDigest
    && previous.replacesBindingDigest === replacesBindingDigest
    && (
      (intent.mode === "create"
        && previous.intent.mode === "create"
        && previous.intent.marker === intent.marker
        && !newCreateAttempt)
      || (intent.mode === "attach"
        && previous.intent.mode === "attach"
        && previous.intent.ticket === intent.ticket)
    );
  const effectiveIntent = reuseBindAttempt ? previous.intent : intent;
  const same = previous?.projection.digest === projection.digest
    && previous.provider === policy.provider
    && previous.targetDigest === targetDigest
    && previous.policyDigest === policyDigest
    && digestJson(previous.intent) === digestJson(effectiveIntent)
    && previous.replacesBindingDigest === replacesBindingDigest;
  const pending = createPendingRecord({
    schemaVersion: policy.schemaVersion,
    provider: policy.provider,
    targetDigest,
    policyDigest,
    projection,
    intent: effectiveIntent,
    replacesBindingDigest,
    idempotencyKey: reuseBindAttempt
      ? previous.idempotencyKey
      : effectiveIntent.mode === "create"
        ? sha256(`empirical-sdd-create\0${targetDigest}\0${projection.feature}\0${randomUUID()}`)
        : replacesBindingDigest
          ? sha256(`empirical-sdd-replace\0${targetDigest}\0${projection.feature}\0${effectiveIntent.ticket}\0${randomUUID()}`)
          : sha256(`empirical-sdd-attach\0${targetDigest}\0${projection.feature}\0${effectiveIntent.ticket}`),
    attempts: same ? previous.attempts + 1 : 1,
    status: "pending",
    failure: null,
    ...(policy.schemaVersion === TRACKER_SCHEMA_VERSION
      ? { effects: previous?.effects ?? [] }
      : {}),
    updatedAt: now(dependencies),
  });
  await writeTrackerPending(root, pending);
  return pending;
}

async function persistFailure(
  root: string,
  pending: TrackerPendingRecord,
  error: unknown,
  dependencies: TrackerDependencies,
): Promise<TrackerPendingRecord> {
  const failed = createPendingRecord({
    ...pending,
    status: "failed",
    failure: failureFrom(error, dependencies),
    updatedAt: now(dependencies),
  });
  await writeTrackerPending(root, failed);
  return failed;
}

async function markCreateDispatched(
  root: string,
  pending: TrackerPendingRecord,
  dependencies: TrackerDependencies,
): Promise<TrackerPendingRecord> {
  if (pending.intent.mode !== "create") return pending;
  const dispatched = createPendingRecord({
    ...pending,
    intent: { ...pending.intent, dispatched: true },
    status: "pending",
    failure: null,
    updatedAt: now(dependencies),
  });
  await writeTrackerPending(root, dispatched);
  return dispatched;
}

function createPendingRecord(
  input: Omit<TrackerPendingRecord, "digest"> & { digest?: string },
): TrackerPendingRecord {
  const { digest: _ignored, ...body } = input;
  return trackerPendingSchema.parse({ ...body, digest: digestJson(body) }) as TrackerPendingRecord;
}

function createBinding(
  feature: string,
  policy: TrackerPolicy,
  input: RemoteTicket,
  bindIdempotencyKey: string,
): TrackerBinding {
  const body = {
    schemaVersion: policy.schemaVersion,
    feature,
    provider: policy.provider,
    remoteId: input.remoteId,
    remoteKey: input.remoteKey,
    url: input.url,
    projectItemId: input.projectItemId,
    markerId: input.markerId,
    targetDigest: trackerTargetDigest(policy),
    bindIdempotencyKey,
    lastSyncedRevision: input.lastSyncedRevision ?? null,
    lastSyncedDigest: input.lastSyncedDigest ?? null,
    lastSyncedPolicyDigest: input.lastSyncedPolicyDigest ?? null,
    ...(policy.schemaVersion === TRACKER_SCHEMA_VERSION ? {
      lastSyncedPhase: input.lastSyncedPhase ?? null,
      lastSyncedStatus: input.lastSyncedStatus ?? null,
      lastSyncedCompletionLevel: input.lastSyncedCompletionLevel ?? null,
      lastSyncedReceiptDigest: input.lastSyncedReceiptDigest ?? null,
    } : {}),
  } as const;
  return trackerBindingSchema.parse({ ...body, digest: digestJson(body) }) as TrackerBinding;
}

function trackerTargetDigest(policy: TrackerPolicy): string {
  return digestJson({ provider: policy.provider, target: policy.target });
}

function trackerProjectionPolicyDigest(policy: TrackerPolicy): string {
  return policy.schemaVersion === TRACKER_LEGACY_SCHEMA_VERSION
    ? digestJson({ provider: policy.provider, target: policy.target, states: policy.states })
    : digestJson({
        schemaVersion: policy.schemaVersion,
        provider: policy.provider,
        target: policy.target,
        states: policy.states,
        ticket: policy.ticket,
        visibility: policy.visibility,
      });
}

function assertBindingScope(policy: TrackerPolicy, binding: TrackerBinding): void {
  if (binding.provider !== policy.provider) {
    throw new EmpiricalError("TRACKER_PROVIDER_MISMATCH", "The feature binding belongs to a different configured provider");
  }
  if (binding.targetDigest !== trackerTargetDigest(policy)) {
    throw new EmpiricalError("TRACKER_TARGET_MISMATCH", "The feature binding belongs to a different configured target");
  }
  const url = new URL(binding.url);
  if (policy.provider === "github") {
    const expectedPath = `/${policy.target.owner}/${policy.target.repository}/issues/${binding.remoteKey}`.toLowerCase();
    if (url.hostname !== "github.com" || url.pathname.toLowerCase() !== expectedPath) {
      throw new EmpiricalError("TRACKER_TARGET_MISMATCH", "GitHub binding URL is outside the configured repository");
    }
  } else if (policy.provider === "jira" && url.origin !== jiraOrigin(policy)) {
    throw new EmpiricalError("TRACKER_TARGET_MISMATCH", "Jira binding URL is outside the configured site");
  }
}

function assertPendingScope(policy: TrackerPolicy, pending: TrackerPendingRecord): void {
  if (pending.provider !== policy.provider) {
    throw new EmpiricalError("TRACKER_PROVIDER_MISMATCH", "Pending tracker work belongs to a different configured provider");
  }
  if (pending.targetDigest !== trackerTargetDigest(policy)) {
    throw new EmpiricalError("TRACKER_TARGET_MISMATCH", "Pending tracker work belongs to a different configured target");
  }
}

async function loadTrackerBinding(root: string, feature: string): Promise<TrackerBinding | null> {
  const path = trackerBindingPath(root, feature);
  await assertFeatureTrackerPath(root, feature, path);
  if (!(await isFile(path))) return null;
  try {
    const parsed = trackerBindingSchema.parse(await readJson<unknown>(path, "INVALID_TRACKER_BINDING")) as TrackerBinding;
    verifyDigest(parsed, "Tracker binding");
    if (parsed.feature !== feature) throw new EmpiricalError("INVALID_TRACKER_BINDING", "Tracker binding feature does not match its path");
    validateStoredBindingUrl(parsed);
    return parsed;
  } catch (error) {
    if (error instanceof EmpiricalError) throw error;
    throw new EmpiricalError("INVALID_TRACKER_BINDING", "Tracker binding is malformed", error);
  }
}

function validateStoredBindingUrl(binding: TrackerBinding): void {
  const stored = new URL(binding.url);
  if (stored.username || stored.password || stored.search || stored.hash) {
    throw new EmpiricalError("INVALID_TRACKER_BINDING", "Stored tracker binding URL contains credentials or mutable URL components");
  }
  if (binding.provider === "github") {
    const url = new URL(validateProviderUrl(binding.url, "github.com"));
    if (!url.pathname.toLowerCase().endsWith(`/issues/${binding.remoteKey}`.toLowerCase())) {
      throw new EmpiricalError("INVALID_TRACKER_BINDING", "Stored GitHub binding URL does not match its issue key");
    }
    return;
  }
  if (binding.provider === "linear") {
    const url = new URL(validateProviderUrl(binding.url, "linear.app"));
    const segments = url.pathname.split("/").filter(Boolean);
    const issueIndex = segments.indexOf("issue");
    if (issueIndex < 0 || segments[issueIndex + 1] !== binding.remoteKey) {
      throw new EmpiricalError("INVALID_TRACKER_BINDING", "Stored Linear binding URL does not match its issue key");
    }
    return;
  }
  const url = new URL(binding.url);
  if (
    url.protocol !== "https:"
    || !url.hostname.endsWith(".atlassian.net")
    || url.port
    || url.username
    || url.password
    || url.search
    || url.hash
    || url.pathname !== `/browse/${binding.remoteKey}`
  ) {
    throw new EmpiricalError("INVALID_TRACKER_BINDING", "Stored Jira binding URL is outside a safe Atlassian issue origin");
  }
}

async function loadTrackerPending(root: string, feature: string): Promise<TrackerPendingRecord | null> {
  const path = trackerPendingPath(root, feature);
  await assertFeatureTrackerPath(root, feature, path);
  if (!(await isFile(path))) return null;
  try {
    const parsed = trackerPendingSchema.parse(await readJson<unknown>(path, "INVALID_TRACKER_PENDING")) as TrackerPendingRecord;
    verifyDigest(parsed, "Tracker pending record");
    verifyDigest(parsed.projection, "Tracker projection");
    if (parsed.projection.feature !== feature) throw new EmpiricalError("INVALID_TRACKER_PENDING", "Tracker pending feature does not match its path");
    return parsed;
  } catch (error) {
    if (error instanceof EmpiricalError) throw error;
    throw new EmpiricalError("INVALID_TRACKER_PENDING", "Tracker pending projection is malformed", error);
  }
}

/**
 * Read and validate durable tracker records without taking a lock, contacting a
 * provider, or mutating recovery state. This deliberately works without a
 * configured policy so Doctor can detect dormant/corrupt tracker artifacts.
 */
export async function inspectTrackerRecords(
  root: string,
  feature: string,
): Promise<{ binding: TrackerBinding | null; pending: TrackerPendingRecord | null }> {
  const [binding, pending] = await Promise.all([
    loadTrackerBinding(root, feature),
    loadTrackerPending(root, feature),
  ]);
  return { binding, pending };
}

async function writeTrackerBinding(root: string, binding: TrackerBinding): Promise<void> {
  const path = trackerBindingPath(root, binding.feature);
  await assertFeatureTrackerPath(root, binding.feature, path);
  await writeJsonAtomic(path, binding);
}

async function writeTrackerPending(root: string, pending: TrackerPendingRecord): Promise<void> {
  const path = trackerPendingPath(root, pending.projection.feature);
  await assertFeatureTrackerPath(root, pending.projection.feature, path);
  await writeJsonAtomic(path, pending);
}

function verifyDigest(value: object, label: string): void {
  const { digest, ...body } = value as Record<string, unknown>;
  if (typeof digest !== "string" || digestJson(body) !== digest) {
    throw new EmpiricalError("INVALID_TRACKER_DIGEST", `${label} digest does not match its contents`);
  }
}

async function requireTrackerPolicy(root: string): Promise<TrackerPolicy> {
  const policy = await loadTrackerPolicy(root);
  if (!policy) throw new EmpiricalError("TRACKER_NOT_CONFIGURED", "Configure a GitHub, Linear, or Jira tracker first");
  return policy;
}

function trackerPolicyPath(root: string): string {
  return join(resolve(root), ".empirical", "tracker.json");
}

function trackerDirectory(root: string, feature: string): string {
  return join(resolve(root), ".empirical", "specs", feature, "tracker");
}

function trackerBindingPath(root: string, feature: string): string {
  return join(trackerDirectory(root, feature), "binding.json");
}

function trackerPendingPath(root: string, feature: string): string {
  return join(trackerDirectory(root, feature), "pending.json");
}

async function assertPlainTrackerPath(root: string, path: string): Promise<void> {
  for (const candidate of [join(resolve(root), ".empirical"), path]) {
    if (await isSymbolicLink(candidate)) {
      throw new EmpiricalError("UNSAFE_TRACKER_PATH", `Tracker storage cannot use symbolic links: ${candidate}`);
    }
  }
}

async function assertFeatureTrackerPath(root: string, feature: string, path: string): Promise<void> {
  const store = new ProjectStore(root).forFeature(feature);
  await store.assertFeaturePathSafe(feature, [trackerDirectory(root, feature), path]);
}

async function withTrackerLock<T>(root: string, feature: string, operation: () => Promise<T>): Promise<T> {
  const path = join(trackerDirectory(root, feature), "tracker.lock");
  await assertFeatureTrackerPath(root, feature, path);
  return withOwnedFileLock(path, operation);
}

function localOnlyStatus(revision: number): TrackerStatus {
  return {
    health: "local-only",
    provider: null,
    url: null,
    committedRevision: revision,
    lastSyncedRevision: null,
    pendingRevision: null,
    failure: null,
  };
}

function offStatus(revision: number, policy: TrackerPolicy): TrackerStatus {
  const effective = effectiveTrackerPolicy(policy);
  return {
    health: "off",
    provider: policy.provider,
    url: null,
    committedRevision: revision,
    lastSyncedRevision: null,
    pendingRevision: null,
    failure: null,
    schemaVersion: policy.schemaVersion,
    ticket: effective.ticket,
    visibility: effective.visibility,
    pendingEffects: 0,
  };
}

function trackerStatusWithPolicy(
  status: TrackerStatus,
  policy: TrackerPolicy,
  pending: TrackerPendingRecord | null,
  binding: TrackerBinding | null,
  state?: Pick<WorkflowState, "request" | "profile">,
): TrackerStatus {
  if (policy.schemaVersion !== TRACKER_SCHEMA_VERSION) return status;
  const resolution = state ? resolveTrackerTicketRequirement(policy, state) : null;
  return {
    ...status,
    provider: status.provider ?? policy.provider,
    schemaVersion: policy.schemaVersion,
    ticket: policy.ticket,
    visibility: policy.visibility,
    ...(resolution?.rules ? {
      changeType: resolution.changeType,
      ticketRequirement: resolution.requirement,
    } : {}),
    pendingEffects: remainingTrackerEffects(policy, pending, binding),
  };
}

function remainingTrackerEffects(
  policy: TrackerPolicy,
  pending: TrackerPendingRecord | null,
  binding: TrackerBinding | null,
): number {
  if (
    policy.schemaVersion !== TRACKER_SCHEMA_VERSION
    || !pending
    || pending.status === "synced"
  ) return 0;
  if (!binding) return 1;
  const keys = [trackerEffectKey(policy, pending.projection, "transition")];
  if (shouldPublishMilestone(policy, binding, pending.projection)) {
    keys.push(trackerEffectKey(policy, pending.projection, "comment"));
    for (const artifact of pending.projection.artifacts ?? []) {
      keys.push(trackerEffectKey(policy, pending.projection, "artifact", artifact.digest));
    }
  }
  return keys.filter((key) => !hasTrackerEffect(pending, key)).length;
}

function failedStatus(
  revision: number,
  provider: TrackerProvider | null,
  url: string | null,
  lastSyncedRevision: number | null,
  trackerFailure: TrackerFailure | null,
  pendingRevision: number | null = revision,
): TrackerStatus {
  return {
    health: "failed",
    provider,
    url,
    committedRevision: revision,
    lastSyncedRevision,
    pendingRevision,
    failure: trackerFailure,
  };
}

function failureFrom(error: unknown, dependencies: TrackerDependencies): TrackerFailure {
  return failure(errorCode(error), error instanceof Error ? error.message : String(error), dependencies);
}

function failure(
  code: string,
  summary: string,
  dependencies: TrackerDependencies,
): TrackerFailure {
  return trackerFailureSchema.parse({
    code: /^[A-Z][A-Z0-9_]{2,63}$/.test(code) ? code : "TRACKER_FAILED",
    summary: safeDiagnostic(summary, []),
    at: now(dependencies),
  }) as TrackerFailure;
}

function errorCode(error: unknown): string {
  return error instanceof EmpiricalError ? error.code : "TRACKER_FAILED";
}

function now(dependencies: TrackerDependencies): string {
  return (dependencies.now ?? (() => new Date()))().toISOString();
}

function safeText(value: string, limit = TRACKER_ERROR_LIMIT): string {
  return value
    .replace(/\b(?:bearer|basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, "[REDACTED]")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|lin_api_[A-Za-z0-9]{16,})\b/g, "[REDACTED]")
    .replace(/((?:token|password|secret|api[_ -]?key)\s*[:=]\s*)\S+/gi, "$1[REDACTED]")
    .trim()
    .slice(0, limit) || "Tracker operation failed";
}

function safeDiagnostic(value: string, secrets: string[]): string {
  let result = value;
  for (const secret of secrets.filter(Boolean)) result = result.split(secret).join("[REDACTED]");
  return safeText(result);
}

function containsSecretLikeValue(value: unknown): boolean {
  if (typeof value === "string") {
    return /\b(?:bearer|basic)\s+[A-Za-z0-9._~+\/-]+=*/i.test(value)
      || /\b(?:gh[pousr]_|github_pat_|lin_api_)[A-Za-z0-9_]{16,}\b/i.test(value)
      || /(?:authorization|password|secret|api[_ -]?key|token)\s*[:=]\s*\S+/i.test(value);
  }
  if (Array.isArray(value)) return value.some(containsSecretLikeValue);
  if (typeof value === "object" && value !== null) {
    return Object.values(value as Record<string, unknown>).some(containsSecretLikeValue);
  }
  return false;
}

function validateJiraSite(value: string): void {
  const url = new URL(value);
  if (
    url.protocol !== "https:"
    || !url.hostname.endsWith(".atlassian.net")
    || url.port
    || url.username
    || url.password
    || url.search
    || url.hash
    || (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new EmpiricalError(
      "INVALID_TRACKER_POLICY",
      "Jira siteUrl must be a credential-free Atlassian Cloud HTTPS origin without port, path, query, or fragment",
    );
  }
}

function validateProviderUrl(value: string, host: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:"
    || url.hostname !== host
    || url.port
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", `Tracker returned an unexpected ${host} URL`);
  }
  return url.toString();
}

function trackerBindIntent(feature: string, input: TrackerBindInput): TrackerBindIntent {
  if (input.mode === "attach") {
    return trackerAttachIntentSchema.parse({ mode: "attach", ticket: input.ticket.trim() }) as TrackerBindIntent;
  }
  const description = safeText(input.description ?? "Tracked by Empirical SDD", 4_000);
  const marker = `empirical-sdd-bind:${feature}`;
  if (description.includes(`<!-- ${marker}:`)) {
    throw new EmpiricalError("INVALID_TRACKER_BIND_INPUT", "Create description cannot contain an Empirical binding marker");
  }
  return trackerCreateIntentSchema.parse({
    mode: "create",
    title: safeText(input.title ?? titleFromFeature(feature), 200),
    description,
    marker,
    dispatched: false,
  }) as TrackerBindIntent;
}

function trackerReferences(request: string | null, policy: TrackerPolicy): string[] {
  if (!request) return [];
  const matches: string[] = [];
  const urls = request.match(/https:\/\/[^\s<>()]+/g) ?? [];
  for (const raw of urls) {
    let url: URL;
    try { url = new URL(raw.replace(/[.,;:!?]+$/, "")); } catch { continue; }
    if (policy.provider === "linear" && url.hostname.toLowerCase() === "linear.app") {
      const segments = url.pathname.split("/").filter(Boolean);
      const issue = segments.indexOf("issue");
      const key = issue >= 0 ? segments[issue + 1] : undefined;
      if (key && REMOTE_ID.test(key)) matches.push(key);
    } else if (policy.provider === "github" && url.hostname.toLowerCase() === "github.com") {
      const segments = url.pathname.split("/").filter(Boolean);
      if (
        segments[0]?.toLowerCase() === policy.target.owner.toLowerCase()
        && segments[1]?.toLowerCase() === policy.target.repository.toLowerCase()
        && segments[2] === "issues"
        && /^\d+$/.test(segments[3] ?? "")
      ) matches.push(segments[3]!);
    } else if (policy.provider === "jira" && url.origin === jiraOrigin(policy)) {
      const segments = url.pathname.split("/").filter(Boolean);
      const browse = segments.indexOf("browse");
      const key = browse >= 0 ? segments[browse + 1] : undefined;
      if (key?.startsWith(`${policy.target.projectKey}-`) && REMOTE_ID.test(key)) matches.push(key);
    }
  }
  return [...new Set(matches)].sort();
}

function failedBindResult(
  state: WorkflowState,
  policy: TrackerPolicy,
  binding: TrackerBinding | null,
  pending: TrackerPendingRecord,
): TrackerBindResult {
  return {
    binding,
    tracker: failedStatus(
      state.revision,
      policy.provider,
      binding?.url ?? null,
      binding?.lastSyncedRevision ?? null,
      pending.failure,
      pending.projection.revision,
    ),
  };
}

function assertRemoteIdentity(binding: TrackerBinding, remote: RemoteTicket): void {
  if (binding.remoteId !== remote.remoteId || binding.remoteKey !== remote.remoteKey) {
    throw new EmpiricalError("TRACKER_IDENTITY_MISMATCH", "Provider response identity does not match the durable tracker binding");
  }
}

function createMarkerBlock(
  intent: Extract<TrackerBindIntent, { mode: "create" }>,
  idempotencyKey: string,
): string {
  const attempt = idempotencyKey.slice("sha256:".length);
  return [
    `<!-- ${intent.marker}:${attempt}:start -->`,
    `Empirical SDD create attempt ${idempotencyKey}`,
    `<!-- ${intent.marker}:${attempt}:end -->`,
  ].join("\n");
}

function appendCreateMarker(
  existing: string,
  intent: Extract<TrackerBindIntent, { mode: "create" }>,
  idempotencyKey: string,
): string {
  const block = createMarkerBlock(intent, idempotencyKey);
  return `${existing.trim()}${existing.trim() ? "\n\n" : ""}${block}`;
}

function hasExactCreateMarker(
  value: unknown,
  intent: Extract<TrackerBindIntent, { mode: "create" }>,
  idempotencyKey: string,
): boolean {
  if (typeof value !== "string") return false;
  const block = createMarkerBlock(intent, idempotencyKey);
  return value.split(block).length === 2;
}

function jiraAdf(description: string): Record<string, unknown> {
  return {
    type: "doc",
    version: 1,
    content: description.split(/\n+/).filter(Boolean).map((text) => ({
      type: "paragraph",
      content: [{ type: "text", text }],
    })),
  };
}

async function reconcileCreate(
  policy: TrackerPolicy,
  pending: TrackerPendingRecord,
  credentials: ResolvedTrackerAuthentication,
  dependencies: TrackerDependencies,
): Promise<RemoteTicket | null> {
  if (pending.intent.mode !== "create") {
    throw new EmpiricalError("INVALID_TRACKER_PENDING", "Create reconciliation requires a durable create intent");
  }
  const matches = policy.provider === "github"
    ? await reconcileGitHubCreate(policy, pending, accessTokenFor(credentials, "github"), dependencies)
    : policy.provider === "linear"
      ? await reconcileLinearCreate(policy, pending, linearAuthorizationFor(credentials), dependencies)
      : await reconcileJiraCreate(policy, pending, credentials, dependencies);
  if (matches.length > 1) {
    throw new EmpiricalError("TRACKER_CREATE_COLLISION", "Multiple provider tickets contain the exact Empirical create marker");
  }
  return matches[0] ?? null;
}

async function reconcileFeatureMarker(
  policy: TrackerPolicy,
  marker: string,
  credentials: ResolvedTrackerAuthentication,
  dependencies: TrackerDependencies,
): Promise<RemoteTicket | null> {
  const matches = policy.provider === "github"
    ? await findGitHubFeatureMarkers(policy, marker, accessTokenFor(credentials, "github"), dependencies)
    : policy.provider === "linear"
      ? await findLinearFeatureMarkers(policy, marker, linearAuthorizationFor(credentials), dependencies)
      : await findJiraFeatureMarkers(policy, marker, credentials, dependencies);
  if (matches.length > 1) {
    throw new EmpiricalError(
      "TRACKER_BIND_AMBIGUOUS",
      "Multiple target-valid tickets contain the stable Empirical feature marker",
    );
  }
  return matches[0] ?? null;
}

async function findGitHubFeatureMarkers(
  policy: GitHubTrackerPolicy,
  marker: string,
  token: string,
  dependencies: TrackerDependencies,
): Promise<RemoteTicket[]> {
  const matches: RemoteTicket[] = [];
  for (let page = 1; page <= TRACKER_DISCOVERY_LIMIT; page += 1) {
    const response = await requestJson(dependencies, {
      method: "GET",
      url: `https://api.github.com/repos/${encodeURIComponent(policy.target.owner)}/${encodeURIComponent(policy.target.repository)}/issues?state=all&per_page=100&page=${page}`,
      headers: githubHeaders(token),
    }, [200], [token]);
    if (!Array.isArray(response)) {
      throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", "GitHub feature-marker lookup is malformed");
    }
    for (const raw of response) {
      const issue = record(raw, "GitHub feature-marker issue");
      if (issue.pull_request !== undefined) continue;
      if (hasStableGitHubCreateMarker(issue.body, marker)) matches.push(parseGitHubIssue(policy, issue));
    }
    if (response.length < 100) return matches;
  }
  throw new EmpiricalError("TRACKER_RECONCILIATION_LIMIT", "GitHub feature-marker lookup exceeded 10,000 issues");
}

async function findLinearFeatureMarkers(
  policy: LinearTrackerPolicy,
  marker: string,
  authorization: string,
  dependencies: TrackerDependencies,
): Promise<RemoteTicket[]> {
  const matches: RemoteTicket[] = [];
  let after: string | null = null;
  const cursors = new Set<string>();
  for (let page = 0; page < TRACKER_DISCOVERY_LIMIT; page += 1) {
    const data = await linearGraphql(
      `query ReconcileFeature($team: ID!, $marker: String!, $after: String) {
        issues(first: 100, after: $after, includeArchived: true,
          filter: {team: {id: {eq: $team}}, description: {contains: $marker}}) {
          nodes { id identifier url description team { id } project { id } }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { team: policy.target.teamId, marker, after },
      authorization,
      dependencies,
    );
    const issues = connection(data.issues, "Linear feature-marker issues");
    for (const raw of issues.nodes) {
      const issue = record(raw, "Linear feature-marker issue");
      const markerResult = linearCreateMarkerMatches(typeof issue.description === "string" ? issue.description : "", marker);
      if (markerResult.malformed) {
        throw new EmpiricalError("TRACKER_MARKER_AMBIGUOUS", "Linear feature marker is malformed or mixed");
      }
      if (markerResult.matches.length === 1) matches.push(parseLinearIssue(policy, issue));
      else if (markerResult.matches.length > 1) {
        throw new EmpiricalError("TRACKER_BIND_AMBIGUOUS", "A Linear ticket contains duplicate stable feature markers");
      }
    }
    if (!issues.hasNextPage) return matches;
    after = nextDiscoveryCursor(issues.endCursor, cursors, "Linear feature-marker lookup");
  }
  throw new EmpiricalError("TRACKER_RECONCILIATION_LIMIT", "Linear feature-marker lookup exceeded 10,000 issues");
}

async function findJiraFeatureMarkers(
  policy: JiraTrackerPolicy,
  marker: string,
  authentication: ResolvedTrackerAuthentication,
  dependencies: TrackerDependencies,
): Promise<RemoteTicket[]> {
  const jira = jiraRequestContext(policy.target.siteUrl, authentication);
  const matches: RemoteTicket[] = [];
  let nextPageToken: string | null = null;
  const cursors = new Set<string>();
  for (let page = 0; page < TRACKER_DISCOVERY_LIMIT; page += 1) {
    const response = record(await requestJson(dependencies, {
      method: "POST",
      url: `${jira.apiOrigin}/rest/api/3/search/jql`,
      headers: jira.headers,
      body: JSON.stringify({
        jql: `project = ${policy.target.projectKey} ORDER BY created DESC`,
        maxResults: 100,
        ...(nextPageToken ? { nextPageToken } : {}),
        fields: ["status", "project", "issuetype"],
        properties: ["empirical-sdd"],
      }),
    }, [200], jira.secrets), "Jira feature-marker lookup");
    if (Array.isArray(response.warnings) && response.warnings.length > 0) {
      throw new EmpiricalError("TRACKER_RECONCILIATION_INCOMPLETE", "Jira reported incomplete feature-marker results");
    }
    if (!Array.isArray(response.issues) || typeof response.isLast !== "boolean") {
      throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", "Jira feature-marker pagination is malformed");
    }
    for (const raw of response.issues) {
      const issue = record(raw, "Jira feature-marker issue");
      const properties = record(issue.properties ?? {}, "Jira feature-marker properties");
      const empirical = properties["empirical-sdd"];
      if (typeof empirical !== "object" || empirical === null || Array.isArray(empirical)) continue;
      const create = record((empirical as Record<string, unknown>).create ?? {}, "Jira feature marker");
      if (create.marker === marker) matches.push(parseJiraIssue(policy, issue, true));
    }
    if (response.isLast) return matches;
    nextPageToken = nextDiscoveryCursor(optionalString(response, "nextPageToken"), cursors, "Jira feature-marker lookup");
  }
  throw new EmpiricalError("TRACKER_RECONCILIATION_LIMIT", "Jira feature-marker lookup exceeded 10,000 issues");
}

function hasStableGitHubCreateMarker(value: unknown, marker: string): boolean {
  if (typeof value !== "string") return false;
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...value.matchAll(new RegExp(`<!-- ${escaped}:([a-f0-9]{64}):start -->`, "g"))];
  if (matches.length !== 1) return false;
  const key = `sha256:${matches[0]![1]}`;
  return hasExactCreateMarker(value, {
    mode: "create",
    title: "marker",
    description: "marker",
    marker,
    dispatched: true,
  }, key);
}

async function reconcileGitHubCreate(
  policy: GitHubTrackerPolicy,
  pending: TrackerPendingRecord,
  token: string,
  dependencies: TrackerDependencies,
): Promise<RemoteTicket[]> {
  if (pending.intent.mode !== "create") return [];
  const matches: RemoteTicket[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const response = await requestJson(dependencies, {
      method: "GET",
      url: `https://api.github.com/repos/${encodeURIComponent(policy.target.owner)}/${encodeURIComponent(policy.target.repository)}/issues?state=all&per_page=100&page=${page}`,
      headers: githubHeaders(token),
    }, [200], [token]);
    if (!Array.isArray(response)) throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", "GitHub issue reconciliation response is malformed");
    for (const raw of response) {
      const issue = record(raw, "GitHub reconciliation issue");
      if (issue.pull_request !== undefined) continue;
      if (hasExactCreateMarker(issue.body, pending.intent, pending.idempotencyKey)) {
        matches.push(parseGitHubIssue(policy, issue));
      }
    }
    if (response.length < 100) return matches;
  }
  throw new EmpiricalError("TRACKER_RECONCILIATION_LIMIT", "GitHub create reconciliation exceeded 10,000 issues");
}

async function reconcileLinearCreate(
  policy: LinearTrackerPolicy,
  pending: TrackerPendingRecord,
  authorization: string,
  dependencies: TrackerDependencies,
): Promise<RemoteTicket[]> {
  if (pending.intent.mode !== "create") return [];
  const matches: RemoteTicket[] = [];
  let after: string | null = null;
  for (let page = 0; page < 100; page += 1) {
    const data = await linearGraphql(
      `query Reconcile($team: ID!, $marker: String!, $after: String) {
        issues(first: 100, after: $after, includeArchived: true,
          filter: {team: {id: {eq: $team}}, description: {contains: $marker}}) {
          nodes { id identifier url description team { id } project { id } }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { team: policy.target.teamId, marker: pending.idempotencyKey, after },
      authorization,
      dependencies,
    );
    const connection = record(data.issues, "Linear reconciliation issues");
    if (!Array.isArray(connection.nodes)) throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", "Linear reconciliation nodes are malformed");
    for (const raw of connection.nodes) {
      const issue = record(raw, "Linear reconciliation issue");
      if (hasExactLinearCreateMarker(issue.description, pending.intent, pending.idempotencyKey)) {
        matches.push(parseLinearIssue(policy, issue));
      }
    }
    const pageInfo = record(connection.pageInfo ?? {}, "Linear reconciliation page info");
    if (typeof pageInfo.hasNextPage !== "boolean") {
      throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", "Linear reconciliation pagination is malformed");
    }
    if (!pageInfo.hasNextPage) return matches;
    after = requiredString(pageInfo, "endCursor", "Linear reconciliation cursor");
  }
  throw new EmpiricalError("TRACKER_RECONCILIATION_LIMIT", "Linear create reconciliation exceeded 10,000 issues");
}

async function reconcileJiraCreate(
  policy: JiraTrackerPolicy,
  pending: TrackerPendingRecord,
  authentication: ResolvedTrackerAuthentication,
  dependencies: TrackerDependencies,
): Promise<RemoteTicket[]> {
  if (pending.intent.mode !== "create") return [];
  const jira = jiraRequestContext(policy.target.siteUrl, authentication);
  const matches: RemoteTicket[] = [];
  let nextPageToken: string | null = null;
  for (let page = 0; page < 100; page += 1) {
    const response = await requestJson(dependencies, {
      method: "POST",
      url: `${jira.apiOrigin}/rest/api/3/search/jql`,
      headers: jira.headers,
      body: JSON.stringify({
        jql: `project = ${policy.target.projectKey} ORDER BY created DESC`,
        maxResults: 100,
        ...(nextPageToken ? { nextPageToken } : {}),
        fields: ["status", "project", "issuetype"],
        properties: ["empirical-sdd"],
      }),
    }, [200], jira.secrets);
    const result = record(response, "Jira reconciliation response");
    if (result.warnings !== undefined) {
      if (!Array.isArray(result.warnings) || result.warnings.some((warning) => typeof warning !== "string")) {
        throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", "Jira reconciliation warnings are malformed");
      }
      if (result.warnings.length > 0) {
        throw new EmpiricalError("TRACKER_RECONCILIATION_INCOMPLETE", "Jira reported an incomplete create reconciliation result");
      }
    }
    if (!Array.isArray(result.issues)) throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", "Jira reconciliation issues are malformed");
    for (const raw of result.issues) {
      const issue = record(raw, "Jira reconciliation issue");
      const properties = record(issue.properties ?? {}, "Jira reconciliation properties");
      const empirical = properties["empirical-sdd"];
      if (typeof empirical !== "object" || empirical === null || Array.isArray(empirical)) continue;
      const create = record((empirical as Record<string, unknown>).create ?? {}, "Jira reconciliation create marker");
      if (create.marker === pending.intent.marker && create.idempotencyKey === pending.idempotencyKey) {
        matches.push(parseJiraIssue(policy, issue, true));
      }
    }
    if (typeof result.isLast !== "boolean") {
      throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", "Jira reconciliation pagination is malformed");
    }
    if (result.isLast) return matches;
    nextPageToken = requiredString(result, "nextPageToken", "Jira reconciliation next-page token");
  }
  throw new EmpiricalError("TRACKER_RECONCILIATION_LIMIT", "Jira create reconciliation exceeded 10,000 issues");
}

function renderProjection(projection: TrackerProjection): string {
  const summary = projection.summary
    ?.replace(/<!--|-->/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const gate = summary ? `\nGate: ${summary}` : "";
  return [
    `<!-- empirical-sdd:${projection.feature}:start -->`,
    `Empirical SDD · ${projection.phase}/${projection.status} · revision ${projection.revision}`,
    `Progress: ${projection.progress} · completion: ${projection.completionLevel}`,
    `Marker: ${projection.marker}${gate}`,
    `<!-- empirical-sdd:${projection.feature}:end -->`,
  ].join("\n");
}

function upsertMarkerBlock(existing: string, projection: TrackerProjection): string {
  const block = renderProjection(projection);
  const start = `<!-- empirical-sdd:${projection.feature}:start -->`;
  const end = `<!-- empirical-sdd:${projection.feature}:end -->`;
  const lines = existing.split("\n");
  const starts = lines.flatMap((line, index) => line === start ? [index] : []);
  const ends = lines.flatMap((line, index) => line === end ? [index] : []);
  if (starts.length === 1 && ends.length === 1 && ends[0]! >= starts[0]!) {
    return [
      ...lines.slice(0, starts[0]),
      ...block.split("\n"),
      ...lines.slice(ends[0]! + 1),
    ].join("\n").trim();
  }
  if (starts.length !== 0 || ends.length !== 0) {
    throw new EmpiricalError("TRACKER_MARKER_AMBIGUOUS", "Existing tracker description contains duplicate or unbalanced Empirical markers");
  }
  return `${existing.trim()}${existing.trim() ? "\n\n" : ""}${block}`;
}

const LINEAR_MARKER_ORIGIN = "https://github.com/goempirical/empirical-sdd";

function linearProjectionBoundary(feature: string, boundary: "start" | "end"): string {
  const label = boundary === "start" ? "Delivery status" : "Managed by Empirical SDD · local workflow is authoritative";
  const heading = boundary === "start" ? "## " : "";
  return `${heading}[${label}](<${LINEAR_MARKER_ORIGIN}#empirical-sdd:${feature}:${boundary}>)`;
}

function linearCreateMarkerLine(
  intent: Extract<TrackerBindIntent, { mode: "create" }>,
  idempotencyKey: string,
): string {
  return `[Crash-safe synchronization enabled](<${LINEAR_MARKER_ORIGIN}#${intent.marker}:${idempotencyKey}>)`;
}

function readableTrackerToken(value: string): string {
  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function readableCompletionLevel(value: string): string {
  return value === "none" ? "Not complete" : readableTrackerToken(value);
}

function renderLinearProjection(projection: TrackerProjection): string {
  const summary = projection.summary
    ?.replace(/<!--|-->/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return [
    linearProjectionBoundary(projection.feature, "start"),
    `[${readableTrackerToken(projection.progress)}](<${LINEAR_MARKER_ORIGIN}#${projection.marker}>)`,
    `- Phase: ${readableTrackerToken(projection.phase)}`,
    `- Workflow: ${readableTrackerToken(projection.status)}`,
    `- Revision: ${projection.revision}`,
    `- Completion: ${readableCompletionLevel(projection.completionLevel)}`,
    ...(summary ? [`Gate: ${summary}`] : []),
    "",
    linearProjectionBoundary(projection.feature, "end"),
  ].join("\n");
}

function upsertLinearMarkerBlock(existing: string, projection: TrackerProjection): string {
  const block = renderLinearProjection(projection);
  const legacyStart = `<!-- empirical-sdd:${projection.feature}:start -->`;
  const legacyEnd = `<!-- empirical-sdd:${projection.feature}:end -->`;
  const readableStart = linearProjectionBoundary(projection.feature, "start");
  const readableEnd = linearProjectionBoundary(projection.feature, "end");
  const priorReadableStart = `[**Empirical SDD**](${LINEAR_MARKER_ORIGIN}#empirical-sdd:${projection.feature}:start)`;
  const priorCanonicalStart = `**[Empirical SDD](<${LINEAR_MARKER_ORIGIN}#empirical-sdd:${projection.feature}:start>)`;
  const priorReadableEnd = `[Managed projection](${LINEAR_MARKER_ORIGIN}#empirical-sdd:${projection.feature}:end)`;
  const priorCanonicalEnd = `[Managed projection](<${LINEAR_MARKER_ORIGIN}#empirical-sdd:${projection.feature}:end>)`;
  const priorHeadingStart = `## [Empirical SDD](<${LINEAR_MARKER_ORIGIN}#empirical-sdd:${projection.feature}:start>)`;
  const priorIndentedReadableEnd = `  ${readableEnd}`;
  const markerFragments = [
    `empirical-sdd:${projection.feature}:start`,
    `empirical-sdd:${projection.feature}:end`,
  ];
  const lines = existing.replace(/\r\n/g, "\n").split("\n");
  const starts = lines.flatMap((line, index) => [legacyStart, readableStart, priorReadableStart, priorCanonicalStart, priorHeadingStart].includes(line) ? [index] : []);
  const ends = lines.flatMap((line, index) => [legacyEnd, readableEnd, priorReadableEnd, priorCanonicalEnd, priorIndentedReadableEnd].includes(line) ? [index] : []);
  const malformed = lines.some((line) => markerFragments.some((fragment) => line.includes(fragment))
    && line !== legacyStart
    && line !== legacyEnd
    && line !== readableStart
    && line !== readableEnd
    && line !== priorReadableStart
    && line !== priorCanonicalStart
    && line !== priorReadableEnd
    && line !== priorCanonicalEnd
    && line !== priorHeadingStart
    && line !== priorIndentedReadableEnd);
  if (
    !malformed
    && starts.length === 1
    && ends.length === 1
    && ends[0]! >= starts[0]!
    && ((lines[starts[0]!] === legacyStart && lines[ends[0]!] === legacyEnd)
      || (lines[starts[0]!] !== legacyStart && lines[ends[0]!] !== legacyEnd))
  ) {
    return [
      ...lines.slice(0, starts[0]),
      ...block.split("\n"),
      ...lines.slice(ends[0]! + 1),
    ].join("\n").trim();
  }
  if (malformed || starts.length !== 0 || ends.length !== 0) {
    throw new EmpiricalError("TRACKER_MARKER_AMBIGUOUS", "Existing Linear description contains duplicate, mixed, malformed, or unbalanced Empirical projection markers");
  }
  return `${existing.trim()}${existing.trim() ? "\n\n" : ""}${block}`;
}

function appendLinearCreateMarker(
  existing: string,
  intent: Extract<TrackerBindIntent, { mode: "create" }>,
  idempotencyKey: string,
): string {
  const marker = linearCreateMarkerLine(intent, idempotencyKey);
  return `${existing.trim()}${existing.trim() ? "\n\n" : ""}${marker}`;
}

interface LinearCreateMarkerMatch {
  kind: "legacy" | "readable";
  start: number;
  end: number;
  idempotencyKey: string;
}

function linearCreateMarkerMatches(value: string, marker: string): { matches: LinearCreateMarkerMatch[]; malformed: boolean } {
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  const markerPrefix = `${marker}:`;
  const legacyStartPrefix = `<!-- ${markerPrefix}`;
  const readablePrefixes = [
    `[Recovery reference](${LINEAR_MARKER_ORIGIN}#${markerPrefix}`,
    `[Crash-safe synchronization enabled](${LINEAR_MARKER_ORIGIN}#${markerPrefix}`,
  ];
  const canonicalReadablePrefixes = [
    `[Recovery reference](<${LINEAR_MARKER_ORIGIN}#${markerPrefix}`,
    `[Crash-safe synchronization enabled](<${LINEAR_MARKER_ORIGIN}#${markerPrefix}`,
  ];
  const matches: LinearCreateMarkerMatch[] = [];
  const consumed = new Set<number>();
  let malformed = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.startsWith(legacyStartPrefix) && line.endsWith(":start -->")) {
      const attempt = line.slice(legacyStartPrefix.length, -":start -->".length);
      const idempotencyKey = `sha256:${attempt}`;
      if (
        /^[a-f0-9]{64}$/.test(attempt)
        && lines[index + 1] === `Empirical SDD create attempt ${idempotencyKey}`
        && lines[index + 2] === `<!-- ${marker}:${attempt}:end -->`
      ) {
        matches.push({ kind: "legacy", start: index, end: index + 2, idempotencyKey });
        consumed.add(index);
        consumed.add(index + 1);
        consumed.add(index + 2);
        index += 2;
        continue;
      }
      malformed = true;
      continue;
    }
    const canonicalReadablePrefix = canonicalReadablePrefixes.find((prefix) => line.startsWith(prefix));
    const readablePrefix = readablePrefixes.find((prefix) => line.startsWith(prefix));
    const activeReadablePrefix = canonicalReadablePrefix ?? readablePrefix ?? null;
    if (activeReadablePrefix && line.endsWith(canonicalReadablePrefix ? ">)" : ")")) {
      const idempotencyKey = line.slice(activeReadablePrefix.length, canonicalReadablePrefix ? -2 : -1);
      if (/^sha256:[a-f0-9]{64}$/.test(idempotencyKey)) {
        matches.push({ kind: "readable", start: index, end: index, idempotencyKey });
        consumed.add(index);
        continue;
      }
      malformed = true;
    }
  }
  lines.forEach((line, index) => {
    if (line.includes(marker) && !consumed.has(index)) malformed = true;
  });
  return { matches, malformed };
}

function hasExactLinearCreateMarker(
  value: unknown,
  intent: Extract<TrackerBindIntent, { mode: "create" }>,
  idempotencyKey: string,
): boolean {
  if (typeof value !== "string") return false;
  const result = linearCreateMarkerMatches(value, intent.marker);
  return !result.malformed
    && result.matches.length === 1
    && result.matches[0]!.idempotencyKey === idempotencyKey;
}

function migrateLinearCreateMarker(existing: string, feature: string): string {
  const marker = `empirical-sdd-bind:${feature}`;
  const result = linearCreateMarkerMatches(existing, marker);
  if (result.malformed || result.matches.length > 1) {
    throw new EmpiricalError("TRACKER_MARKER_AMBIGUOUS", "Existing Linear description contains duplicate, mixed, or malformed Empirical recovery markers");
  }
  const match = result.matches[0];
  if (!match || match.kind === "readable") return existing;
  const lines = existing.replace(/\r\n/g, "\n").split("\n");
  const replacement = `[Crash-safe synchronization enabled](<${LINEAR_MARKER_ORIGIN}#${marker}:${match.idempotencyKey}>)`;
  return [
    ...lines.slice(0, match.start),
    replacement,
    ...lines.slice(match.end + 1),
  ].join("\n");
}

function isExactOwnedMarkerBlock(body: string, start: string, end: string): boolean {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  return lines[0] === start
    && lines.at(-1) === end
    && lines.filter((line) => line === start).length === 1
    && lines.filter((line) => line === end).length === 1;
}

function idempotencyLabel(projection: TrackerProjection): string {
  return sha256(`${projection.marker}\0${projection.digest}`).slice("sha256:".length, "sha256:".length + 32);
}

function titleFromFeature(feature: string): string {
  return feature.split("-").filter(Boolean).map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`).join(" ");
}

interface TrackerConnection {
  nodes: unknown[];
  hasNextPage: boolean;
  endCursor: string | null;
}

function connection(value: unknown, label: string): TrackerConnection {
  const result = record(value, label);
  if (!Array.isArray(result.nodes)) {
    throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", `${label} nodes are missing or malformed`);
  }
  if (result.pageInfo === undefined || result.pageInfo === null) {
    return { nodes: result.nodes, hasNextPage: false, endCursor: null };
  }
  const pageInfo = record(result.pageInfo, `${label} page info`);
  if (typeof pageInfo.hasNextPage !== "boolean") {
    throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", `${label} pagination is malformed`);
  }
  const endCursor = pageInfo.endCursor === null || pageInfo.endCursor === undefined
    ? null
    : requiredString(pageInfo, "endCursor", `${label} cursor`);
  if (pageInfo.hasNextPage && endCursor === null) {
    throw new EmpiricalError("TRACKER_DISCOVERY_INCOMPLETE", `${label} has another page without a cursor`);
  }
  return { nodes: result.nodes, hasNextPage: pageInfo.hasNextPage, endCursor };
}

function assertTerminalConnection(value: TrackerConnection, label: string): void {
  if (value.hasNextPage) {
    throw new EmpiricalError(
      "TRACKER_DISCOVERY_INCOMPLETE",
      `${label} requires additional nested pagination and cannot be applied from partial metadata`,
    );
  }
}

function nextDiscoveryCursor(value: string | null, seen: Set<string>, label: string): string {
  if (!value || seen.has(value)) {
    throw new EmpiricalError("TRACKER_DISCOVERY_INCOMPLETE", `${label} pagination cursor did not advance`);
  }
  seen.add(value);
  return value;
}

function discoveryResource(
  input: Pick<TrackerDiscoveryResource, "kind" | "id" | "name">
  & Partial<Omit<TrackerDiscoveryResource, "kind" | "id" | "name">>,
): TrackerDiscoveryResource {
  return {
    kind: input.kind,
    id: input.id,
    name: input.name,
    parentId: input.parentId ?? null,
    position: input.position ?? null,
    stateType: input.stateType ?? null,
    key: input.key ?? null,
    url: input.url ?? null,
  };
}

function validateDiscoveryResource(resource: TrackerDiscoveryResource): void {
  if (!REMOTE_ID.test(resource.id) && !/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(resource.id)) {
    throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", `Tracker discovery returned an invalid ${resource.kind} id`);
  }
  if (!resource.name.trim() || resource.name.length > 256 || /[\0\r\n]/.test(resource.name)) {
    throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", `Tracker discovery returned an invalid ${resource.kind} name`);
  }
  if (resource.parentId !== null && !REMOTE_ID.test(resource.parentId) && !/^https:\/\//.test(resource.parentId)) {
    throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", `Tracker discovery returned an invalid ${resource.kind} parent`);
  }
  if (resource.position !== null && (!Number.isFinite(resource.position) || resource.position < 0)) {
    throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", `Tracker discovery returned an invalid ${resource.kind} position`);
  }
  if (resource.url !== null) {
    const url = new URL(resource.url);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) {
      throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", `Tracker discovery returned an unsafe ${resource.kind} URL`);
    }
  }
}

function compareDiscoveryResources(left: TrackerDiscoveryResource, right: TrackerDiscoveryResource): number {
  const kinds = ["workspace", "team", "repository", "project", "issue-type", "field", "state"];
  return kinds.indexOf(left.kind) - kinds.indexOf(right.kind)
    || (left.parentId ?? "").localeCompare(right.parentId ?? "")
    || (left.position ?? Number.MAX_SAFE_INTEGER) - (right.position ?? Number.MAX_SAFE_INTEGER)
    || left.name.localeCompare(right.name)
    || left.id.localeCompare(right.id);
}

function trackerAdapterCapabilities(provider: TrackerProvider): TrackerDiscovery["capabilities"] {
  return {
    comments: true,
    uploads: provider === "jira",
    durableLinks: true,
  };
}

function verifyTrackerDiscovery(discovery: TrackerDiscovery): void {
  if (discovery.schemaVersion !== 1 || discovery.complete !== true) {
    throw new EmpiricalError("INVALID_TRACKER_DISCOVERY", "Tracker discovery is incomplete or has an unsupported schema");
  }
  const { digest, ...body } = discovery;
  if (digestJson(body) !== digest) {
    throw new EmpiricalError("INVALID_TRACKER_DISCOVERY", "Tracker discovery digest does not match its contents");
  }
  for (const resource of discovery.resources) validateDiscoveryResource(resource);
}

function normalizedStatePositions(states: TrackerDiscoveryResource[]): Map<string, number> {
  const ordered = [...states].sort((left, right) =>
    (left.position ?? Number.MAX_SAFE_INTEGER) - (right.position ?? Number.MAX_SAFE_INTEGER)
    || left.name.localeCompare(right.name)
    || left.id.localeCompare(right.id));
  const numeric = ordered.map((state, index) => state.position ?? index);
  const min = Math.min(...numeric);
  const max = Math.max(...numeric);
  return new Map(ordered.map((state, index) => [
    state.id,
    max === min ? 0.5 : (numeric[index]! - min) / (max - min),
  ]));
}

function mappingCandidate(
  provider: TrackerProvider,
  phase: TrackerProgressState,
  state: TrackerDiscoveryResource,
  position: number,
): TrackerMappingCandidate {
  const semantic = normalizedStateType(state.stateType, state.name);
  const semanticRank = stateSemanticRank(provider, phase, semantic);
  const targetPosition: Record<TrackerProgressState, number> = {
    specification: 0,
    planned: 0.2,
    "in-progress": 0.42,
    verification: 0.68,
    review: 0.82,
    blocked: 0.42,
    done: 1,
  };
  const positionRank = Math.round(Math.abs(position - targetPosition[phase]) * 10_000);
  const nameRank = stateNameRank(phase, state.name);
  return {
    stateId: state.id,
    name: state.name,
    primaryRank: semanticRank * 1_000_000 + positionRank,
    nameRank,
    reasons: [
      `provider semantic ${semantic}`,
      `lifecycle position ${position.toFixed(3)}`,
      nameRank === 0 ? "compatible name refinement" : "no name refinement",
    ],
  };
}

function normalizedStateType(value: string | null, name: string): string {
  const normalized = (value ?? "").trim().toLowerCase().replace(/[ _-]+/g, "-");
  if (["backlog", "triage"].includes(normalized)) return normalized;
  if (["unstarted", "todo", "to-do", "open", "new"].includes(normalized)) return "unstarted";
  if (["started", "in-progress", "indeterminate", "current"].includes(normalized)) return "started";
  if (["completed", "done", "closed", "success"].includes(normalized)) return "completed";
  if (["canceled", "cancelled", "removed"].includes(normalized)) return "canceled";
  if (["option", "status", ""].includes(normalized)) return "generic";
  const nameValue = name.toLowerCase();
  if (/\b(done|complete|closed)\b/.test(nameValue)) return "completed";
  if (/\b(todo|backlog|planned|ready|open)\b/.test(nameValue)) return "unstarted";
  if (/\b(progress|doing|qa|test|review|blocked)\b/.test(nameValue)) return "started";
  return normalized;
}

function stateSemanticRank(
  provider: TrackerProvider,
  phase: TrackerProgressState,
  semantic: string,
): number {
  if (provider !== "linear" && semantic === "generic") return 0;
  const preferred: Record<TrackerProgressState, string[]> = {
    specification: ["backlog", "triage", "unstarted"],
    planned: ["unstarted", "backlog", "triage"],
    "in-progress": ["started"],
    verification: ["started"],
    review: ["started"],
    blocked: ["started", "unstarted"],
    done: ["completed"],
  };
  const index = preferred[phase].indexOf(semantic);
  if (index >= 0) return index;
  return semantic === "canceled" ? 9 : 5;
}

function stateNameRank(phase: TrackerProgressState, value: string): number {
  const name = value.toLowerCase().replace(/[_-]+/g, " ");
  const patterns: Record<TrackerProgressState, RegExp> = {
    specification: /\b(spec|backlog|triage|todo)\b/,
    planned: /\b(todo|plan|ready|backlog)\b/,
    "in-progress": /\b(in progress|progress|doing|started)\b/,
    verification: /\b(qa|test|verify|verification|validation)\b/,
    review: /\b(review|approval)\b/,
    blocked: /\b(blocked|stalled|waiting)\b/,
    done: /\b(done|complete|completed|closed)\b/,
  };
  return patterns[phase].test(name) ? 0 : 1;
}

function discoveryInputForPolicy(policy: TrackerPolicy): TrackerDiscoveryInput {
  if (policy.provider === "github") {
    return { provider: "github", credentialEnv: { ...policy.credentialEnv } };
  }
  if (policy.provider === "linear") {
    return { provider: "linear", credentialEnv: { ...policy.credentialEnv } };
  }
  return {
    provider: "jira",
    target: { siteUrl: policy.target.siteUrl },
    credentialEnv: { ...policy.credentialEnv },
  };
}

function policyStateParent(policy: TrackerPolicy): string {
  return policy.provider === "linear"
    ? policy.target.teamId
    : policy.provider === "github"
      ? policy.target.statusFieldId
      : policy.target.projectKey;
}

function validatePolicySelection(
  policy: TrackerPolicy,
  discovery: TrackerDiscovery,
  suggestion: TrackerMappingSuggestion,
): { target: TrackerPolicyPreview["target"]; mapping: TrackerMappingSuggestion } {
  if (policy.provider !== discovery.provider) {
    throw new EmpiricalError("TRACKER_PROVIDER_MISMATCH", "Tracker discovery belongs to a different provider");
  }
  const find = (kind: TrackerDiscoveryResource["kind"], predicate: (resource: TrackerDiscoveryResource) => boolean, label: string) => {
    const matches = discovery.resources.filter((resource) => resource.kind === kind && predicate(resource));
    if (matches.length !== 1) {
      throw new EmpiricalError("TRACKER_TARGET_UNAVAILABLE", `Configured ${label} was not uniquely accessible during discovery`);
    }
    return matches[0]!;
  };
  const target: TrackerPolicyPreview["target"] = [];
  let stateParent: string;
  if (policy.provider === "linear") {
    const team = find("team", (resource) => resource.id === policy.target.teamId, "Linear team");
    target.push({ kind: team.kind, id: team.id, name: team.name });
    if (policy.target.projectId !== null) {
      const project = find("project", (resource) => resource.id === policy.target.projectId && resource.parentId === team.id, "Linear project");
      target.push({ kind: project.kind, id: project.id, name: project.name });
    }
    stateParent = team.id;
  } else if (policy.provider === "github") {
    const owner = find("workspace", (resource) => resource.key?.toLowerCase() === policy.target.owner.toLowerCase(), "GitHub owner");
    const repository = find("repository", (resource) =>
      resource.parentId === owner.id
      && (resource.key?.toLowerCase() === `${policy.target.owner}/${policy.target.repository}`.toLowerCase()
        || resource.name.toLowerCase() === policy.target.repository.toLowerCase()), "GitHub repository");
    const project = find("project", (resource) => resource.id === policy.target.projectId && resource.parentId === owner.id, "GitHub project");
    const field = find("field", (resource) => resource.id === policy.target.statusFieldId && resource.parentId === project.id, "GitHub status field");
    target.push(
      { kind: owner.kind, id: owner.id, name: owner.name },
      { kind: repository.kind, id: repository.id, name: repository.name },
      { kind: project.kind, id: project.id, name: project.name },
      { kind: field.kind, id: field.id, name: field.name },
    );
    stateParent = field.id;
  } else {
    const origin = new URL(policy.target.siteUrl).origin;
    const workspace = find("workspace", (resource) => resource.id === origin, "Jira site");
    const project = find("project", (resource) => resource.id === policy.target.projectKey && resource.parentId === workspace.id, "Jira project");
    const issueType = find("issue-type", (resource) => resource.id === policy.target.issueTypeId && resource.parentId === project.id, "Jira issue type");
    target.push(
      { kind: workspace.kind, id: workspace.id, name: workspace.name },
      { kind: project.kind, id: project.id, name: project.name },
      { kind: issueType.kind, id: issueType.id, name: issueType.name },
    );
    stateParent = project.id;
  }
  const phases = { ...suggestion.phases };
  for (const phase of TRACKER_PROGRESS_STATES) {
    const selected = find("state", (resource) => resource.id === policy.states[phase] && resource.parentId === stateParent, `${phase} state`);
    phases[phase] = {
      ...phases[phase],
      selectedStateId: selected.id,
      ambiguous: false,
    };
  }
  return {
    target,
    mapping: { provider: policy.provider, phases, states: { ...policy.states }, ambiguous: [] },
  };
}

function optionalString(value: Record<string, unknown>, key: string): string | null {
  const entry = value[key];
  if (entry === undefined || entry === null || entry === "") return null;
  if (typeof entry !== "string" || entry.length > 2_048 || /[\0\r\n]/.test(entry)) {
    throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", `Tracker field ${key} is malformed`);
  }
  return entry;
}

function optionalFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalSafeUrl(
  value: Record<string, unknown>,
  key: string,
  expectedHost: string,
): string | null {
  const entry = optionalString(value, key);
  return entry === null ? null : validateProviderUrl(entry, expectedHost);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", `${label} is missing or malformed`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: Record<string, unknown>, key: string, label: string): string {
  const result = value[key];
  if (typeof result !== "string" || !result.trim() || !REMOTE_ID.test(result.trim())) {
    throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", `${label} is missing or malformed`);
  }
  return result.trim();
}

function requiredDisplayString(value: Record<string, unknown>, key: string, label: string): string {
  const result = value[key];
  if (
    typeof result !== "string"
    || !result.trim()
    || result.trim().length > 256
    || /[\0\r\n]/.test(result)
  ) {
    throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", `${label} is missing or malformed`);
  }
  return result.trim();
}

function requiredUrlString(value: Record<string, unknown>, key: string, label: string): string {
  const result = value[key];
  if (typeof result !== "string" || !result.trim() || result.trim().length > 2_048) {
    throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", `${label} is missing or malformed`);
  }
  try {
    new URL(result.trim());
  } catch {
    throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", `${label} is missing or malformed`);
  }
  return result.trim();
}

function requiredNumber(value: unknown, key: string, label: string): number {
  const result = record(value, label)[key];
  if (typeof result !== "number" || !Number.isSafeInteger(result) || result < 0) {
    throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", `${label} is missing or malformed`);
  }
  return result;
}

function nestedString(value: unknown, path: string[], label: string): string {
  const result = nestedOptionalString(record(value, label), path);
  if (!result || !REMOTE_ID.test(result)) {
    throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", `${label} is missing or malformed`);
  }
  return result;
}

function nestedOptionalString(value: Record<string, unknown>, path: string[]): string | null {
  let current: unknown = value;
  for (const segment of path) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "string" && current.trim() ? current.trim() : null;
}

export type {
  TrackerBinding,
  TrackerPendingRecord,
  TrackerPolicy,
  TrackerProjection,
  TrackerStateMap,
  TrackerStatus,
};
