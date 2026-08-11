import { Buffer } from "node:buffer";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import { z } from "zod";

import { EmpiricalError } from "./errors.js";
import { digestJson, sha256 } from "./protocol.js";
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
  TrackerBindResult,
  TrackerBinding,
  TrackerDependencies,
  TrackerFailure,
  TrackerHttpRequest,
  TrackerHttpResponse,
  TrackerPendingRecord,
  TrackerPolicy,
  TrackerProgressState,
  TrackerProjection,
  TrackerProvider,
  TrackerStateMap,
  TrackerStatus,
  TrackerSyncResult,
  TrackerTransport,
  WorkflowState,
} from "./types.js";

export const TRACKER_SCHEMA_VERSION = 1 as const;
const TRACKER_TIMEOUT_MS = 30_000;
const TRACKER_MAX_RESPONSE_BYTES = 1_048_576;
const TRACKER_ERROR_LIMIT = 500;
const ENVIRONMENT_NAME = /^(?=.{2,64}$)[A-Z][A-Z0-9]*_[A-Z0-9_]+$/;
const REMOTE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:+\/=\-]{0,255}$/;
const PROJECT_KEY = /^[A-Z][A-Z0-9_]{0,31}$/;

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

const githubTrackerPolicySchema = z.object({
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
}).strict();

const linearTrackerPolicySchema = z.object({
  schemaVersion: z.literal(TRACKER_SCHEMA_VERSION),
  provider: z.literal("linear"),
  target: z.object({
    teamId: remoteIdSchema,
    projectId: remoteIdSchema.nullable(),
  }).strict(),
  credentialEnv: z.object({ apiKey: environmentNameSchema }).strict(),
  states: trackerStateMapSchema,
}).strict();

const jiraTrackerPolicySchema = z.object({
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
}).strict();

export const trackerPolicySchema = z.discriminatedUnion("provider", [
  githubTrackerPolicySchema,
  linearTrackerPolicySchema,
  jiraTrackerPolicySchema,
]);

const trackerProjectionSchema = z.object({
  schemaVersion: z.literal(TRACKER_SCHEMA_VERSION),
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
}).strict();

const trackerFailureSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/),
  summary: z.string().min(1).max(TRACKER_ERROR_LIMIT),
  at: z.string().datetime({ offset: true }),
}).strict();

const trackerBindingSchema = z.object({
  schemaVersion: z.literal(TRACKER_SCHEMA_VERSION),
  feature: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  provider: z.enum(["github", "linear", "jira"]),
  remoteId: remoteIdSchema,
  remoteKey: remoteIdSchema,
  url: z.string().url().max(2048),
  projectItemId: remoteIdSchema.nullable(),
  markerId: remoteIdSchema.nullable(),
  lastSyncedRevision: z.number().int().nonnegative().nullable(),
  lastSyncedDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable(),
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
}).strict();

const trackerPendingSchema = z.object({
  schemaVersion: z.literal(TRACKER_SCHEMA_VERSION),
  provider: z.enum(["github", "linear", "jira"]),
  projection: trackerProjectionSchema,
  idempotencyKey: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  attempts: z.number().int().nonnegative(),
  status: z.enum(["pending", "failed", "synced"]),
  failure: trackerFailureSchema.nullable(),
  updatedAt: z.string().datetime({ offset: true }),
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
}).strict();

export function parseTrackerPolicy(value: unknown): TrackerPolicy {
  let parsed: TrackerPolicy;
  try {
    parsed = trackerPolicySchema.parse(value) as TrackerPolicy;
  } catch (error) {
    throw new EmpiricalError(
      "INVALID_TRACKER_POLICY",
      "Tracker Policy v1 must select one provider with a strict secret-free target and complete state mapping",
      error,
    );
  }
  if (parsed.provider === "jira") validateJiraSite(parsed.target.siteUrl);
  if (containsSecretLikeValue(parsed)) {
    throw new EmpiricalError(
      "INVALID_TRACKER_POLICY",
      "Tracker Policy v1 contains a secret-like value; persist only provider identifiers and credential environment-variable names",
    );
  }
  return parsed;
}

export async function loadTrackerPolicy(root: string): Promise<TrackerPolicy | null> {
  const path = trackerPolicyPath(root);
  await assertPlainTrackerPath(root, path);
  if (!(await isFile(path))) return null;
  return parseTrackerPolicy(await readJson<unknown>(path, "INVALID_TRACKER_POLICY"));
}

export async function configureTrackerPolicy(
  root: string,
  value: unknown,
): Promise<TrackerPolicy | null> {
  const path = trackerPolicyPath(root);
  await assertPlainTrackerPath(root, path);
  if (value === null) {
    await rm(path, { force: true });
    return null;
  }
  const policy = parseTrackerPolicy(value);
  await writeJsonAtomic(path, policy);
  return policy;
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

export function createTrackerProjection(state: WorkflowState): TrackerProjection {
  if (!state.activeFeature) {
    throw new EmpiricalError("TRACKER_FEATURE_REQUIRED", "Tracker projection requires an active feature");
  }
  const body = {
    schemaVersion: TRACKER_SCHEMA_VERSION,
    feature: state.activeFeature,
    phase: state.phase,
    status: state.status,
    revision: state.revision,
    completionLevel: state.completion.highest,
    progress: trackerProgress(state),
    summary: state.status === "blocked" || state.status === "awaiting_human"
      ? safeText(state.message ?? "Empirical is waiting at a workflow gate")
      : null,
    marker: `empirical-sdd:${state.activeFeature}:r${state.revision}`,
  } as const;
  return trackerProjectionSchema.parse({ ...body, digest: digestJson(body) }) as TrackerProjection;
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
  try {
    const [binding, pending] = await Promise.all([
      loadTrackerBinding(root, state.activeFeature),
      loadTrackerPending(root, state.activeFeature),
    ]);
    if (binding && binding.provider !== policy.provider) {
      return failedStatus(
        state.revision,
        policy.provider,
        binding.url,
        binding.lastSyncedRevision,
        failure("TRACKER_PROVIDER_MISMATCH", "The feature binding belongs to a different configured provider", dependencies),
      );
    }
    if (!binding) {
      if (pending?.status === "failed") {
        return failedStatus(state.revision, policy.provider, null, null, pending.failure);
      }
      return {
        health: "pending",
        provider: policy.provider,
        url: null,
        committedRevision: state.revision,
        lastSyncedRevision: null,
        pendingRevision: pending?.projection.revision ?? state.revision,
        failure: null,
      };
    }
    if (
      binding.lastSyncedRevision === state.revision
      && binding.lastSyncedDigest === createTrackerProjection(state).digest
      && (!pending || pending.status === "synced")
    ) {
      return {
        health: "synced",
        provider: binding.provider,
        url: binding.url,
        committedRevision: state.revision,
        lastSyncedRevision: binding.lastSyncedRevision,
        pendingRevision: null,
        failure: null,
      };
    }
    if (pending?.status === "failed" && pending.projection.revision >= (binding.lastSyncedRevision ?? -1)) {
      return failedStatus(
        state.revision,
        binding.provider,
        binding.url,
        binding.lastSyncedRevision,
        pending.failure,
        pending.projection.revision,
      );
    }
    return {
      health: "pending",
      provider: binding.provider,
      url: binding.url,
      committedRevision: state.revision,
      lastSyncedRevision: binding.lastSyncedRevision,
      pendingRevision: pending?.projection.revision ?? state.revision,
      failure: null,
    };
  } catch (error) {
    return failedStatus(state.revision, policy.provider, null, null, failureFrom(error, dependencies));
  }
}

export async function bindTracker(
  root: string,
  state: WorkflowState,
  input: TrackerBindInput,
  dependencies: TrackerDependencies = {},
): Promise<TrackerBindResult> {
  if (!state.activeFeature || state.phase === "idle") {
    throw new EmpiricalError("TRACKER_FEATURE_REQUIRED", "Create or attach a ticket only after a feature starts");
  }
  const feature = state.activeFeature;
  const policy = await requireTrackerPolicy(root);
  return withTrackerLock(root, feature, async () => {
    const existing = await loadTrackerBinding(root, feature);
    if (existing && input.replace !== true) {
      if (input.mode === "attach" && input.ticket === existing.remoteKey) {
        return { binding: existing, tracker: await trackerStatus(root, state, dependencies) };
      }
      throw new EmpiricalError(
        "TRACKER_ALREADY_BOUND",
        `Feature ${state.activeFeature} is already bound to ${existing.provider}:${existing.remoteKey}`,
      );
    }
    if (input.mode === "attach" && !input.ticket?.trim()) {
      throw new EmpiricalError("TRACKER_TICKET_REQUIRED", "Attach mode requires a provider ticket id or key");
    }
    const projection = createTrackerProjection(state);
    const previousPending = await loadTrackerPending(root, feature);
    if (
      input.mode === "create"
      && previousPending?.failure?.code === "TRACKER_CREATE_AMBIGUOUS"
      && input.confirmCreateRetry !== true
    ) {
      throw new EmpiricalError(
        "TRACKER_CREATE_CONFIRMATION_REQUIRED",
        "The prior create may have succeeded; reconcile or explicitly confirm a new create attempt",
      );
    }
    const pending = await persistPending(root, policy, projection, previousPending, dependencies);
    let binding = existing;
    try {
      const credentials = resolveCredentials(policy, dependencies.env ?? process.env);
      const created = input.mode === "create"
        ? await createRemoteTicket(policy, projection, input, credentials, dependencies)
        : await attachRemoteTicket(policy, input.ticket!.trim(), credentials, dependencies);
      binding = createBinding(feature, policy.provider, created);
      await writeTrackerBinding(root, binding);
      const synced = await synchronizeBound(
        root,
        state,
        policy,
        binding,
        pending,
        credentials,
        dependencies,
      );
      return { binding: synced.binding, tracker: synced.tracker };
    } catch (error) {
      const ambiguous = input.mode === "create" && errorCode(error) === "TRACKER_TRANSPORT_FAILED";
      const recorded = await persistFailure(
        root,
        pending,
        ambiguous
          ? new EmpiricalError("TRACKER_CREATE_AMBIGUOUS", "The provider create response was not observed")
          : error,
        dependencies,
      );
      return {
        binding,
        tracker: failedStatus(
          state.revision,
          policy.provider,
          binding?.url ?? null,
          binding?.lastSyncedRevision ?? null,
          recorded.failure,
          projection.revision,
        ),
      };
    }
  });
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
  return withTrackerLock(root, state.activeFeature, async () => {
    const binding = await loadTrackerBinding(root, state.activeFeature!);
    if (!binding) {
      return {
        binding: null,
        tracker: await trackerStatus(root, state, dependencies),
        projection: createTrackerProjection(state),
      };
    }
    if (binding.provider !== policy.provider) {
      const mismatch = failure(
        "TRACKER_PROVIDER_MISMATCH",
        "The feature binding belongs to a different configured provider",
        dependencies,
      );
      return {
        binding,
        tracker: failedStatus(state.revision, policy.provider, binding.url, binding.lastSyncedRevision, mismatch),
        projection: createTrackerProjection(state),
      };
    }
    const projection = createTrackerProjection(state);
    if (
      binding.lastSyncedRevision === projection.revision
      && binding.lastSyncedDigest === projection.digest
    ) {
      const pending = await loadTrackerPending(root, state.activeFeature!);
      if (
        pending
        && pending.projection.digest === projection.digest
        && pending.status !== "synced"
      ) {
        await writeTrackerPending(root, createPendingRecord({
          ...pending,
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
    const previousPending = await loadTrackerPending(root, state.activeFeature!);
    const pending = await persistPending(root, policy, projection, previousPending, dependencies);
    try {
      const credentials = resolveCredentials(policy, dependencies.env ?? process.env);
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
      const recorded = await persistFailure(root, pending, error, dependencies);
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
    throw new EmpiricalError("TRACKER_TRANSPORT_FAILED", "Tracker request did not return a response", error);
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
  credentials: string[],
  dependencies: TrackerDependencies,
): Promise<TrackerSyncResult> {
  const updated = await projectRemoteTicket(policy, binding, pending.projection, credentials, dependencies);
  const nextBinding = createBinding(state.activeFeature!, policy.provider, {
    remoteId: updated.remoteId,
    remoteKey: updated.remoteKey,
    url: updated.url,
    projectItemId: updated.projectItemId,
    markerId: updated.markerId,
    lastSyncedRevision: pending.projection.revision,
    lastSyncedDigest: pending.projection.digest,
  });
  await writeTrackerBinding(root, nextBinding);
  const acknowledged = createPendingRecord({
    ...pending,
    status: "synced",
    failure: null,
    updatedAt: now(dependencies),
  });
  await writeTrackerPending(root, acknowledged);
  return {
    binding: nextBinding,
    projection: pending.projection,
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
}

async function createRemoteTicket(
  policy: TrackerPolicy,
  projection: TrackerProjection,
  input: TrackerBindInput,
  credentials: string[],
  dependencies: TrackerDependencies,
): Promise<RemoteTicket> {
  const title = safeText(input.title ?? titleFromFeature(projection.feature), 200);
  const description = safeText(input.description ?? "Tracked by Empirical SDD", 4_000);
  if (policy.provider === "github") return createGitHubTicket(policy, title, description, credentials[0]!, dependencies);
  if (policy.provider === "linear") return createLinearTicket(policy, projection, title, description, credentials[0]!, dependencies);
  return createJiraTicket(policy, projection, title, credentials[0]!, credentials[1]!, dependencies);
}

async function attachRemoteTicket(
  policy: TrackerPolicy,
  ticket: string,
  credentials: string[],
  dependencies: TrackerDependencies,
): Promise<RemoteTicket> {
  if (!REMOTE_ID.test(ticket)) throw new EmpiricalError("INVALID_TRACKER_TICKET", "Tracker ticket id or key is invalid");
  if (policy.provider === "github") return attachGitHubTicket(policy, ticket, credentials[0]!, dependencies);
  if (policy.provider === "linear") return attachLinearTicket(ticket, credentials[0]!, dependencies);
  return attachJiraTicket(policy, ticket, credentials[0]!, credentials[1]!, dependencies);
}

async function projectRemoteTicket(
  policy: TrackerPolicy,
  binding: TrackerBinding,
  projection: TrackerProjection,
  credentials: string[],
  dependencies: TrackerDependencies,
): Promise<RemoteTicket> {
  if (policy.provider === "github") return syncGitHubTicket(policy, binding, projection, credentials[0]!, dependencies);
  if (policy.provider === "linear") return syncLinearTicket(policy, binding, projection, credentials[0]!, dependencies);
  return syncJiraTicket(policy, binding, projection, credentials[0]!, credentials[1]!, dependencies);
}

async function createGitHubTicket(
  policy: GitHubTrackerPolicy,
  title: string,
  description: string,
  token: string,
  dependencies: TrackerDependencies,
): Promise<RemoteTicket> {
  const issue = await requestJson(
    dependencies,
    {
      method: "POST",
      url: `https://api.github.com/repos/${encodeURIComponent(policy.target.owner)}/${encodeURIComponent(policy.target.repository)}/issues`,
      headers: githubHeaders(token),
      body: JSON.stringify({ title, body: description }),
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
  return parseGitHubIssue(policy, issue);
}

async function syncGitHubTicket(
  policy: GitHubTrackerPolicy,
  binding: TrackerBinding,
  projection: TrackerProjection,
  token: string,
  dependencies: TrackerDependencies,
): Promise<RemoteTicket> {
  let projectItemId = binding.projectItemId;
  if (!projectItemId) {
    projectItemId = await findGitHubProjectItem(policy, binding.remoteId, token, dependencies);
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
  }
  let markerId = binding.markerId;
  const comment = renderProjection(projection);
  if (!markerId) {
    markerId = await findGitHubMarkerComment(policy, binding.remoteKey, projection.feature, token, dependencies);
  }
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
      if (typeof candidate.body === "string" && candidate.body.includes(marker)) {
        return String(requiredNumber(candidate, "id", "GitHub comment id"));
      }
    }
    if (response.length < 100) return null;
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
    if (pageInfo.hasNextPage !== true) return null;
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
  const url = validateProviderUrl(requiredString(issue, "html_url", "GitHub issue URL"), "github.com");
  const expectedPath = `/${policy.target.owner}/${policy.target.repository}/issues/${remoteKey}`.toLowerCase();
  if (new URL(url).pathname.toLowerCase() !== expectedPath) {
    throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", "GitHub returned an issue URL outside the configured repository");
  }
  return { remoteId, remoteKey, url, projectItemId: null, markerId: null };
}

async function createLinearTicket(
  policy: LinearTrackerPolicy,
  projection: TrackerProjection,
  title: string,
  description: string,
  apiKey: string,
  dependencies: TrackerDependencies,
): Promise<RemoteTicket> {
  const data = await linearGraphql(
    `mutation Create($input: IssueCreateInput!) {
      issueCreate(input: $input) { success issue { id identifier url } }
    }`,
    {
      input: {
        title,
        description: upsertMarkerBlock(description, projection),
        teamId: policy.target.teamId,
        ...(policy.target.projectId ? { projectId: policy.target.projectId } : {}),
        stateId: policy.states[projection.progress],
      },
    },
    apiKey,
    dependencies,
  );
  const create = record(data.issueCreate, "Linear issueCreate");
  if (create.success !== true) throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", "Linear did not confirm issue creation");
  return parseLinearIssue(create.issue);
}

async function attachLinearTicket(
  ticket: string,
  apiKey: string,
  dependencies: TrackerDependencies,
): Promise<RemoteTicket> {
  const data = await linearGraphql(
    `query Issue($id: String!) { issue(id: $id) { id identifier url } }`,
    { id: ticket },
    apiKey,
    dependencies,
  );
  return parseLinearIssue(data.issue);
}

async function syncLinearTicket(
  policy: LinearTrackerPolicy,
  binding: TrackerBinding,
  projection: TrackerProjection,
  apiKey: string,
  dependencies: TrackerDependencies,
): Promise<RemoteTicket> {
  const current = await linearGraphql(
    `query Issue($id: String!) { issue(id: $id) { id identifier url description } }`,
    { id: binding.remoteId },
    apiKey,
    dependencies,
  );
  const issue = record(current.issue, "Linear issue");
  const description = typeof issue.description === "string" ? issue.description : "";
  const updated = await linearGraphql(
    `mutation Update($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) { success issue { id identifier url } }
    }`,
    {
      id: binding.remoteId,
      input: {
        description: upsertMarkerBlock(description, projection),
        stateId: policy.states[projection.progress],
      },
    },
    apiKey,
    dependencies,
  );
  const update = record(updated.issueUpdate, "Linear issueUpdate");
  if (update.success !== true) throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", "Linear did not confirm issue update");
  return { ...parseLinearIssue(update.issue), projectItemId: null, markerId: null };
}

async function linearGraphql(
  query: string,
  variables: Record<string, unknown>,
  apiKey: string,
  dependencies: TrackerDependencies,
): Promise<Record<string, unknown>> {
  const response = await requestJson(
    dependencies,
    {
      method: "POST",
      url: "https://api.linear.app/graphql",
      headers: { Authorization: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    },
    [200],
    [apiKey],
  );
  return graphqlData(response, "Linear");
}

function parseLinearIssue(value: unknown): RemoteTicket {
  const issue = record(value, "Linear issue");
  const remoteKey = requiredString(issue, "identifier", "Linear issue identifier");
  const url = validateProviderUrl(requiredString(issue, "url", "Linear issue URL"), "linear.app");
  const segments = new URL(url).pathname.split("/").filter(Boolean);
  const issueIndex = segments.indexOf("issue");
  if (issueIndex < 0 || segments[issueIndex + 1] !== remoteKey) {
    throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", "Linear returned an issue URL with a mismatched identifier");
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
  title: string,
  email: string,
  apiToken: string,
  dependencies: TrackerDependencies,
): Promise<RemoteTicket> {
  const issue = await requestJson(
    dependencies,
    {
      method: "POST",
      url: `${jiraOrigin(policy)}/rest/api/3/issue`,
      headers: jiraHeaders(email, apiToken),
      body: JSON.stringify({
        fields: {
          project: { key: policy.target.projectKey },
          issuetype: { id: policy.target.issueTypeId },
          summary: title,
        },
        properties: [{ key: "empirical-sdd", value: projection }],
      }),
    },
    [201],
    [email, apiToken],
  );
  return parseJiraIssue(policy, issue);
}

async function attachJiraTicket(
  policy: JiraTrackerPolicy,
  ticket: string,
  email: string,
  apiToken: string,
  dependencies: TrackerDependencies,
): Promise<RemoteTicket> {
  const issue = await requestJson(
    dependencies,
    {
      method: "GET",
      url: `${jiraOrigin(policy)}/rest/api/3/issue/${encodeURIComponent(ticket)}?fields=status`,
      headers: jiraHeaders(email, apiToken),
    },
    [200],
    [email, apiToken],
  );
  return parseJiraIssue(policy, issue);
}

async function syncJiraTicket(
  policy: JiraTrackerPolicy,
  binding: TrackerBinding,
  projection: TrackerProjection,
  email: string,
  apiToken: string,
  dependencies: TrackerDependencies,
): Promise<RemoteTicket> {
  const issue = await requestJson(
    dependencies,
    {
      method: "GET",
      url: `${jiraOrigin(policy)}/rest/api/3/issue/${encodeURIComponent(binding.remoteKey)}?fields=status`,
      headers: jiraHeaders(email, apiToken),
    },
    [200],
    [email, apiToken],
  );
  const issueRecord = record(issue, "Jira issue");
  await requestJson(
    dependencies,
    {
      method: "PUT",
      url: `${jiraOrigin(policy)}/rest/api/3/issue/${encodeURIComponent(binding.remoteKey)}/properties/empirical-sdd`,
      headers: jiraHeaders(email, apiToken),
      body: JSON.stringify(projection),
    },
    [200, 201, 204],
    [email, apiToken],
  );
  const desired = policy.states[projection.progress];
  const currentStatus = nestedOptionalString(issueRecord, ["fields", "status", "id"]);
  if (currentStatus !== desired) {
    const available = await requestJson(
      dependencies,
      {
        method: "GET",
        url: `${jiraOrigin(policy)}/rest/api/3/issue/${encodeURIComponent(binding.remoteKey)}/transitions`,
        headers: jiraHeaders(email, apiToken),
      },
      [200],
      [email, apiToken],
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
        url: `${jiraOrigin(policy)}/rest/api/3/issue/${encodeURIComponent(binding.remoteKey)}/transitions`,
        headers: jiraHeaders(email, apiToken),
        body: JSON.stringify({ transition: { id: requiredString(selected, "id", "Jira transition id") } }),
      },
      [204],
      [email, apiToken],
    );
  }
  return { ...binding, url: `${jiraOrigin(policy)}/browse/${encodeURIComponent(binding.remoteKey)}` };
}

function jiraHeaders(email: string, apiToken: string): Record<string, string> {
  return {
    Accept: "application/json",
    Authorization: `Basic ${Buffer.from(`${email}:${apiToken}`, "utf8").toString("base64")}`,
    "Content-Type": "application/json",
  };
}

function jiraOrigin(policy: JiraTrackerPolicy): string {
  return new URL(policy.target.siteUrl).origin;
}

function parseJiraIssue(policy: JiraTrackerPolicy, value: unknown): RemoteTicket {
  const issue = record(value, "Jira issue");
  const remoteId = requiredString(issue, "id", "Jira issue id");
  const remoteKey = requiredString(issue, "key", "Jira issue key");
  if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(remoteKey)) {
    throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", "Jira returned an invalid issue key");
  }
  return {
    remoteId,
    remoteKey,
    url: `${jiraOrigin(policy)}/browse/${encodeURIComponent(remoteKey)}`,
    projectItemId: null,
    markerId: null,
  };
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
    if (error instanceof EmpiricalError) throw error;
    throw new EmpiricalError("TRACKER_TRANSPORT_FAILED", "Tracker request did not return a response", error);
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

function resolveCredentials(
  policy: TrackerPolicy,
  environment: Readonly<Record<string, string | undefined>>,
): string[] {
  const names = policy.provider === "github"
    ? [policy.credentialEnv.token]
    : policy.provider === "linear"
      ? [policy.credentialEnv.apiKey]
      : [policy.credentialEnv.email, policy.credentialEnv.apiToken];
  return names.map((name) => {
    const value = environment[name]?.trim();
    if (!value) {
      throw new EmpiricalError("TRACKER_CREDENTIAL_MISSING", `Required tracker environment variable ${name} is not set`);
    }
    return value;
  });
}

async function persistPending(
  root: string,
  policy: TrackerPolicy,
  projection: TrackerProjection,
  previous: TrackerPendingRecord | null,
  dependencies: TrackerDependencies,
): Promise<TrackerPendingRecord> {
  const same = previous?.projection.digest === projection.digest && previous.provider === policy.provider;
  const pending = createPendingRecord({
    schemaVersion: TRACKER_SCHEMA_VERSION,
    provider: policy.provider,
    projection,
    idempotencyKey: sha256(`empirical-sdd\0${policy.provider}\0${projection.feature}\0${projection.revision}\0${projection.digest}`),
    attempts: same ? previous.attempts + 1 : 1,
    status: "pending",
    failure: null,
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

function createPendingRecord(
  input: Omit<TrackerPendingRecord, "digest"> & { digest?: string },
): TrackerPendingRecord {
  const { digest: _ignored, ...body } = input;
  return trackerPendingSchema.parse({ ...body, digest: digestJson(body) }) as TrackerPendingRecord;
}

function createBinding(
  feature: string,
  provider: TrackerProvider,
  input: RemoteTicket,
): TrackerBinding {
  const body = {
    schemaVersion: TRACKER_SCHEMA_VERSION,
    feature,
    provider,
    remoteId: input.remoteId,
    remoteKey: input.remoteKey,
    url: input.url,
    projectItemId: input.projectItemId,
    markerId: input.markerId,
    lastSyncedRevision: input.lastSyncedRevision ?? null,
    lastSyncedDigest: input.lastSyncedDigest ?? null,
  } as const;
  return trackerBindingSchema.parse({ ...body, digest: digestJson(body) }) as TrackerBinding;
}

async function loadTrackerBinding(root: string, feature: string): Promise<TrackerBinding | null> {
  const path = trackerBindingPath(root, feature);
  await assertFeatureTrackerPath(root, feature, path);
  if (!(await isFile(path))) return null;
  try {
    const parsed = trackerBindingSchema.parse(await readJson<unknown>(path, "INVALID_TRACKER_BINDING")) as TrackerBinding;
    verifyDigest(parsed, "Tracker binding");
    if (parsed.feature !== feature) throw new EmpiricalError("INVALID_TRACKER_BINDING", "Tracker binding feature does not match its path");
    return parsed;
  } catch (error) {
    if (error instanceof EmpiricalError) throw error;
    throw new EmpiricalError("INVALID_TRACKER_BINDING", "Tracker binding is malformed", error);
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
  if (url.protocol !== "https:" || url.hostname !== host || url.port) {
    throw new EmpiricalError("TRACKER_MALFORMED_RESPONSE", `Tracker returned an unexpected ${host} URL`);
  }
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function renderProjection(projection: TrackerProjection): string {
  const gate = projection.summary ? `\nGate: ${projection.summary}` : "";
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
  const startIndex = existing.indexOf(start);
  const endIndex = existing.indexOf(end);
  if (startIndex >= 0 && endIndex >= startIndex) {
    return `${existing.slice(0, startIndex)}${block}${existing.slice(endIndex + end.length)}`.trim();
  }
  return `${existing.trim()}${existing.trim() ? "\n\n" : ""}${block}`;
}

function idempotencyLabel(projection: TrackerProjection): string {
  return sha256(`${projection.marker}\0${projection.digest}`).slice("sha256:".length, "sha256:".length + 32);
}

function titleFromFeature(feature: string): string {
  return feature.split("-").filter(Boolean).map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`).join(" ");
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
