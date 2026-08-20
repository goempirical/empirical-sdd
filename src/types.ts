export {
  MANIFEST_SCHEMA_VERSION,
  POLICY_SCHEMA_VERSION,
  PRODUCT_VERSION,
  RECEIPT_SCHEMA_VERSION,
  SCHEMA_VERSION,
} from "./protocol.js";
import {
  POLICY_SCHEMA_VERSION,
  SCHEMA_VERSION,
  type CompletionReport,
  type ExecutionMode,
  type RiskFloor,
  type StandingAuthorization,
} from "./protocol.js";

export type Workflow = "fast" | "complex";
export type Profile = Workflow | "quick";
export type Phase =
  | "idle"
  | "shape"
  | "specify"
  | "design"
  | "plan"
  | "implement"
  | "context"
  | "verify"
  | "review"
  | "integrate"
  | "deliver"
  | "publish"
  | "archive"
  | "done";
export type WorkflowStatus =
  | "idle"
  | "waiting"
  | "awaiting_human"
  | "blocked"
  | "done";
export type Outcome = "passed" | "failed" | "awaiting_human" | "blocked";
export type EvidenceKind = "test" | "browser" | "screenshot" | "review" | "human";
export type ChangeType = "feature" | "fix" | "chore";
export type IsolationMode = "ask" | "off";
export type ComplexDecisionMode = "required" | "off";
export type QuestionMode = "concise" | "detailed";

export interface IsolationConfig {
  mode: IsolationMode;
  baseBranch: string;
  worktreePath: string;
  branchPattern: string;
}

export interface DecisionConfig {
  complexRecords: ComplexDecisionMode;
}

export interface InteractionConfig {
  questions: QuestionMode;
}

export interface ProjectConfig {
  schemaVersion: typeof SCHEMA_VERSION;
  profile: Profile;
  maxRepairAttempts: number;
  evidence: {
    required: boolean;
    browserForUi: boolean;
    screenshotForUi: boolean;
    codeReview: boolean;
  };
  isolation: IsolationConfig;
  decisions: DecisionConfig;
  interaction: InteractionConfig;
  setupComplete: boolean;
  legacySource: "ai" | null;
}

export interface ProjectConfigurationInput {
  evidence?: Partial<ProjectConfig["evidence"]>;
  isolation?: Partial<IsolationConfig>;
  decisions?: Partial<DecisionConfig>;
  interaction?: Partial<InteractionConfig>;
  setupComplete?: boolean;
}

export interface WorkflowState {
  schemaVersion: typeof SCHEMA_VERSION;
  revision: number;
  activeFeature: string | null;
  request: string | null;
  profile: Profile;
  workflow: Workflow;
  mode: ExecutionMode;
  phase: Phase;
  status: WorkflowStatus;
  repairAttempts: number;
  message: string | null;
  implementationActor: string | null;
  specDigest: string | null;
  approvedSpecRevision: number | null;
  capabilityArchiveRequired: boolean;
  capabilityDeltaDigest: string | null;
  impactDigest: string | null;
  capabilityClaimId: string | null;
  authorizationDigest: string | null;
  evidence: Evidence[];
  evidenceReceiptIds: string[];
  legacyEvidenceCount: number;
  completion: CompletionReport;
  updatedAt: string;
}

export type TrackerProvider = "github" | "linear" | "jira";
export type TrackerProgressState =
  | "specification"
  | "planned"
  | "in-progress"
  | "verification"
  | "review"
  | "blocked"
  | "done";
export type TrackerHealth = "local-only" | "off" | "pending" | "synced" | "failed";
export type TrackerStateMap = Record<TrackerProgressState, string>;
export type TrackerTicketPolicy = "off" | "manual" | "ensure";
export type TrackerProgressVisibility = "blockers-final" | "milestones" | "revisions";
export type TrackerTicketRequirement = "required" | "optional" | "off";
export type TrackerTicketRules = Record<
  ChangeType,
  Record<Profile, TrackerTicketRequirement>
>;

export interface TrackerTicketResolution {
  changeType: ChangeType;
  requirement: TrackerTicketRequirement;
  rules: boolean;
}

export interface GitHubTrackerPolicyV1 {
  schemaVersion: 1;
  provider: "github";
  target: {
    owner: string;
    repository: string;
    projectId: string;
    statusFieldId: string;
  };
  credentialEnv: { token: string };
  states: TrackerStateMap;
}

export interface GitHubTrackerPolicyV2 extends Omit<GitHubTrackerPolicyV1, "schemaVersion"> {
  schemaVersion: 2;
  ticket: TrackerTicketPolicy;
  visibility: TrackerProgressVisibility;
  ticketRules?: TrackerTicketRules | undefined;
}

export type GitHubTrackerPolicy = GitHubTrackerPolicyV1 | GitHubTrackerPolicyV2;

export interface LinearTrackerPolicyV1 {
  schemaVersion: 1;
  provider: "linear";
  target: {
    teamId: string;
    projectId: string | null;
  };
  credentialEnv: { apiKey: string };
  states: TrackerStateMap;
}

export interface LinearTrackerPolicyV2 extends Omit<LinearTrackerPolicyV1, "schemaVersion"> {
  schemaVersion: 2;
  ticket: TrackerTicketPolicy;
  visibility: TrackerProgressVisibility;
  ticketRules?: TrackerTicketRules | undefined;
}

export type LinearTrackerPolicy = LinearTrackerPolicyV1 | LinearTrackerPolicyV2;

export interface JiraTrackerPolicyV1 {
  schemaVersion: 1;
  provider: "jira";
  target: {
    siteUrl: string;
    projectKey: string;
    issueTypeId: string;
  };
  credentialEnv: { email: string; apiToken: string };
  states: TrackerStateMap;
}

export interface JiraTrackerPolicyV2 extends Omit<JiraTrackerPolicyV1, "schemaVersion"> {
  schemaVersion: 2;
  ticket: TrackerTicketPolicy;
  visibility: TrackerProgressVisibility;
  ticketRules?: TrackerTicketRules | undefined;
}

export type JiraTrackerPolicy = JiraTrackerPolicyV1 | JiraTrackerPolicyV2;

export type TrackerPolicy = GitHubTrackerPolicy | LinearTrackerPolicy | JiraTrackerPolicy;

export interface EffectiveTrackerPolicy {
  policy: TrackerPolicy;
  schemaVersion: 1 | 2;
  ticket: TrackerTicketPolicy;
  visibility: TrackerProgressVisibility | "legacy";
  compatibility: "v1" | "v2";
  ticketRules?: TrackerTicketRules | undefined;
}

export type TrackerDiscoveryResourceKind =
  | "workspace"
  | "team"
  | "repository"
  | "project"
  | "issue-type"
  | "field"
  | "state";

export interface TrackerDiscoveryResource {
  kind: TrackerDiscoveryResourceKind;
  id: string;
  name: string;
  parentId: string | null;
  position: number | null;
  stateType: string | null;
  key: string | null;
  url: string | null;
}

export interface GitHubTrackerDiscoveryInput {
  provider: "github";
  credentialEnv: { token: string };
}

export interface LinearTrackerDiscoveryInput {
  provider: "linear";
  credentialEnv: { apiKey: string };
}

export interface JiraTrackerDiscoveryInput {
  provider: "jira";
  target: { siteUrl: string };
  credentialEnv: { email: string; apiToken: string };
}

export type TrackerDiscoveryInput =
  | GitHubTrackerDiscoveryInput
  | LinearTrackerDiscoveryInput
  | JiraTrackerDiscoveryInput;

export interface TrackerAdapterCapabilities {
  comments: boolean;
  uploads: boolean;
  durableLinks: boolean;
}

export interface TrackerDiscovery {
  schemaVersion: 1;
  provider: TrackerProvider;
  resources: TrackerDiscoveryResource[];
  capabilities: TrackerAdapterCapabilities;
  complete: true;
  digest: string;
}

export interface TrackerMappingCandidate {
  stateId: string;
  name: string;
  primaryRank: number;
  nameRank: number;
  reasons: string[];
}

export interface TrackerPhaseMappingSuggestion {
  phase: TrackerProgressState;
  selectedStateId: string | null;
  ambiguous: boolean;
  candidates: TrackerMappingCandidate[];
}

export interface TrackerMappingSuggestion {
  provider: TrackerProvider;
  phases: Record<TrackerProgressState, TrackerPhaseMappingSuggestion>;
  states: TrackerStateMap | null;
  ambiguous: TrackerProgressState[];
}

export interface TrackerPolicyPreview {
  schemaVersion: 1;
  policy: TrackerPolicy;
  effective: {
    ticket: TrackerTicketPolicy;
    visibility: TrackerProgressVisibility | "legacy";
    compatibility: "v1" | "v2";
  };
  target: Array<{ kind: TrackerDiscoveryResourceKind; id: string; name: string }>;
  mapping: TrackerMappingSuggestion;
  valid: true;
  digest: string;
}

export type TrackerSetupChange =
  | { mode: "preserve" }
  | { mode: "disabled" }
  | { mode: "apply"; policy: TrackerPolicy };

export interface TrackerArtifact {
  receiptId: string;
  path: string;
  mediaType: string;
  digest: string;
  size: number;
  url: string | null;
}

export interface TrackerEffectAcknowledgement {
  key: string;
  kind: "transition" | "comment" | "artifact";
  remoteId: string | null;
  at: string;
}

export interface TrackerProjection {
  schemaVersion: 1 | 2;
  feature: string;
  phase: Phase;
  status: WorkflowStatus;
  revision: number;
  completionLevel: CompletionReport["highest"];
  progress: TrackerProgressState;
  summary: string | null;
  blocker?: string | null;
  receiptIds?: string[];
  receiptDigest?: string;
  artifacts?: TrackerArtifact[];
  marker: string;
  digest: string;
}

export interface TrackerFailure {
  code: string;
  summary: string;
  at: string;
}

export interface TrackerBinding {
  schemaVersion: 1 | 2;
  feature: string;
  provider: TrackerProvider;
  remoteId: string;
  remoteKey: string;
  url: string;
  projectItemId: string | null;
  markerId: string | null;
  /** Digest of the provider and remote target this binding is confined to. */
  targetDigest: string;
  /** Durable bind attempt that produced this remote association. */
  bindIdempotencyKey: string;
  lastSyncedRevision: number | null;
  lastSyncedDigest: string | null;
  /** Digest of the target and state mapping used by the last acknowledged projection. */
  lastSyncedPolicyDigest: string | null;
  lastSyncedPhase?: Phase | null;
  lastSyncedStatus?: WorkflowStatus | null;
  lastSyncedCompletionLevel?: CompletionReport["highest"] | null;
  lastSyncedReceiptDigest?: string | null;
  digest: string;
}

export interface TrackerCreateIntent {
  mode: "create";
  title: string;
  description: string;
  /** Stable logical marker for this feature/target; the pending idempotency key identifies the attempt. */
  marker: string;
  /** Set durably immediately before the provider create request is dispatched. */
  dispatched: boolean;
}

export interface TrackerAttachIntent {
  mode: "attach";
  ticket: string;
}

export type TrackerBindIntent = TrackerCreateIntent | TrackerAttachIntent;

export interface TrackerPendingRecord {
  schemaVersion: 1 | 2;
  provider: TrackerProvider;
  targetDigest: string;
  policyDigest: string;
  projection: TrackerProjection;
  intent: TrackerBindIntent;
  /** Binding superseded by an explicit replacement; it must never satisfy this pending intent. */
  replacesBindingDigest: string | null;
  idempotencyKey: string;
  attempts: number;
  status: "pending" | "failed" | "synced";
  failure: TrackerFailure | null;
  effects?: TrackerEffectAcknowledgement[];
  updatedAt: string;
  digest: string;
}

export interface TrackerStatus {
  health: TrackerHealth;
  provider: TrackerProvider | null;
  url: string | null;
  committedRevision: number;
  lastSyncedRevision: number | null;
  pendingRevision: number | null;
  failure: TrackerFailure | null;
  schemaVersion?: 1 | 2;
  ticket?: TrackerTicketPolicy;
  visibility?: TrackerProgressVisibility | "legacy";
  changeType?: ChangeType;
  ticketRequirement?: TrackerTicketRequirement;
  pendingEffects?: number;
}

export interface ProjectStatus extends WorkflowState {
  interaction: InteractionConfig;
  tracker: TrackerStatus;
}

export interface TrackerCreateBindInput {
  mode: "create";
  title?: string;
  description?: string;
  replace?: true;
  confirmCreateRetry?: true;
}

export interface TrackerAttachBindInput {
  mode: "attach";
  ticket: string;
  replace?: true;
}

export type TrackerBindInput = TrackerCreateBindInput | TrackerAttachBindInput;

export interface TrackerHttpRequest {
  method: "GET" | "POST" | "PATCH" | "PUT";
  url: string;
  headers: Record<string, string>;
  body?: string | Uint8Array;
  timeoutMs: number;
  maxResponseBytes: number;
}

export interface TrackerHttpResponse {
  status: number;
  body: string;
}

export type TrackerTransport = (request: TrackerHttpRequest) => Promise<TrackerHttpResponse>;

/** Secret-free context supplied to a trusted host OAuth broker. */
export type TrackerOAuthRequest =
  | { provider: "github" }
  | { provider: "linear" }
  | { provider: "jira"; siteUrl: string };

/**
 * An out-of-band authorization handoff. This descriptor must never contain a
 * provider credential; the tracker runtime validates it before use.
 */
export interface TrackerOAuthAuthorization {
  provider: TrackerProvider;
  elicitationId: string;
  message: string;
  url: string;
}

/** Ephemeral credentials returned only by a trusted host OAuth broker. */
export type TrackerOAuthCredential =
  | { provider: "github"; accessToken: string }
  | { provider: "linear"; accessToken: string }
  | { provider: "jira"; accessToken: string; cloudId: string };

/**
 * Host-owned OAuth boundary. Registration, callbacks, refresh, revocation,
 * and encrypted token custody remain outside Empirical.
 */
export interface TrackerOAuthResolver {
  authorize?(request: TrackerOAuthRequest): Promise<TrackerOAuthAuthorization | null>;
  resolve(request: TrackerOAuthRequest): Promise<TrackerOAuthCredential | null>;
}

export type TrackerAuthenticationSource = "oauth" | "environment" | "file";

/** Ephemeral runtime authentication. Values must never be serialized. */
export type ResolvedTrackerAuthentication =
  | {
      provider: "github";
      source: TrackerAuthenticationSource;
      accessToken: string;
    }
  | {
      provider: "linear";
      source: TrackerAuthenticationSource;
      accessToken: string;
    }
  | {
      provider: "jira";
      source: "oauth";
      accessToken: string;
      cloudId: string;
    }
  | {
      provider: "jira";
      source: "environment" | "file";
      email: string;
      apiToken: string;
    };

export interface TrackerAuthenticationGuidance {
  provider: TrackerProvider;
  oauthPreferred: true;
  credentialNames: string[];
  secretFilePath: string;
  warning: "Never paste credentials into chat";
  message: string;
}

export interface TrackerDependencies {
  transport?: TrackerTransport;
  env?: Readonly<Record<string, string | undefined>>;
  now?: () => Date;
  oauthResolver?: TrackerOAuthResolver;
  /** Explicit trusted-host override; also keeps tests independent of user files. */
  secretFilePath?: string;
  /** Repository boundary used to reject repository-contained secret files. */
  repositoryRoot?: string;
  /** Deterministic platform override for embeddings and tests. */
  platform?: "posix" | "win32";
  /** Deterministic home-directory override for embeddings and tests. */
  homeDirectory?: string;
  /** Development-only allowance for loopback HTTP authorization URLs. */
  allowInsecureOAuthLoopback?: boolean;
}

export interface TrackerBindResult {
  binding: TrackerBinding | null;
  tracker: TrackerStatus;
}

export interface TrackerSyncResult {
  binding: TrackerBinding | null;
  tracker: TrackerStatus;
  projection: TrackerProjection | null;
}

export interface ProjectPolicy {
  schemaVersion: typeof POLICY_SCHEMA_VERSION;
  context: string[];
  phases: Partial<Record<Phase, string[]>>;
  verification: {
    evidence: ProjectConfig["evidence"];
    commands: Array<{
      id: string;
      argv: string[];
      cwd: string;
      timeoutMs: number;
      maxOutputBytes: number;
      evidenceKinds: EvidenceKind[];
      criteria: string[];
    }>;
  };
  delivery: {
    provider: "github";
    targetBranch: string;
    requiredChecks: string[];
  } | null;
  preferredAgent: AgentIntegrationId | null;
}

export interface Criterion {
  id: string;
  text: string;
  ui: boolean;
  checked: boolean;
}

export interface Evidence {
  criterionId: string;
  kind: EvidenceKind;
  passed: boolean;
  summary: string;
  artifact?: string;
}

export interface CompletionInput {
  revision: number;
  outcome: Outcome;
  summary: string;
  actor?: string;
  receiptIds?: string[];
  /** Schema-4 compatibility input; Schema 5 rejects asserted evidence. */
  evidence?: Evidence[];
}

export interface ActionRationale {
  currentState: string;
  nextAction: string;
  reason: string;
  requiredContext: string[];
  missingContext: string[];
  gate: "proceed" | "stop";
}

export interface ActionPacket {
  kind: "action";
  protocol: "empirical-sdd";
  schemaVersion: typeof SCHEMA_VERSION;
  root: string;
  feature: string | null;
  request: string | null;
  profile: Profile;
  mode: ExecutionMode;
  riskFloor: RiskFloor;
  routeRationale: string[];
  interaction: InteractionConfig;
  phase: Phase;
  status: WorkflowStatus;
  revision: number;
  instructions: string;
  rationale: ActionRationale;
  acceptanceCriteria: Criterion[];
  requiredEvidence: EvidenceKind[];
  artifacts: string[];
  projectContext: string[];
  knowledgeContext: string[];
  capabilityContext: string[];
  completionLevel: CompletionReport;
  tracker: TrackerStatus;
  completion: {
    available: boolean;
    mcpTool: "empirical_complete" | "empirical_integrate" | "empirical_deliver" | "empirical_publish";
    cli: string;
    requiredFields: string[];
  };
}

export interface WorktreeProposal {
  kind: "worktree_proposal";
  protocol: "empirical-sdd";
  schemaVersion: typeof SCHEMA_VERSION;
  root: string;
  request: string;
  workflow: Workflow;
  changeType: ChangeType;
  feature: string;
  branch: string;
  path: string;
  base: string;
  baseCommit: string;
  activeFeature: string;
  approvalToken: string;
  command: string[];
  requiresApproval: true;
}

export interface WorktreeCreateInput {
  request: string;
  workflow: Workflow;
  changeType?: ChangeType;
  feature?: string;
  branch?: string;
  path?: string;
  base?: string;
  baseCommit: string;
  activeFeature: string;
  approvalToken: string;
  approved: true;
}

export interface WorktreeHandoff {
  kind: "worktree_handoff";
  protocol: "empirical-sdd";
  schemaVersion: typeof SCHEMA_VERSION;
  root: string;
  path: string;
  branch: string;
  base: string;
  baseCommit: string;
  feature: string;
  revision: number;
  workflow: Workflow;
  resume: string;
  action: ActionPacket;
}

export type FeatureStartResult = ActionPacket | WorktreeProposal;

export interface DecisionSummary {
  id: string;
  title: string;
  status: "Accepted" | "Superseded";
  chosenApproach: string;
  supersedes: string[];
  supersededBy: string | null;
}

export interface DecisionValidationReport {
  valid: boolean;
  decisions: DecisionSummary[];
  issues: string[];
}

export interface ExplainReport {
  protocol: "empirical-sdd";
  schemaVersion: typeof SCHEMA_VERSION;
  root: string;
  feature: string | null;
  phase: Phase;
  status: WorkflowStatus;
  revision: number;
  rationale: ActionRationale;
  decisions: DecisionSummary[];
  tracker: TrackerStatus;
}

export interface ExplorationPacket {
  protocol: "empirical-sdd";
  schemaVersion: typeof SCHEMA_VERSION;
  root: string;
  problem: string;
  instructions: string[];
  questions: string[];
  projectContext: string[];
  knowledgeContext: string[];
  capabilityContext: string[];
  next: {
    fast: string;
    complex: string;
  };
}

export type DeltaOperation = "added" | "modified" | "removed";

export interface RequirementDelta {
  operation: DeltaOperation;
  name: string;
  contents: string;
}

export interface CapabilityDelta {
  capability: string;
  purpose: string | null;
  requirements: RequirementDelta[];
  source: string;
}

export interface CapabilitySummary {
  name: string;
  path: string;
  requirements: number;
}

export interface DeltaValidationReport {
  valid: boolean;
  capabilities: string[];
  operations: number;
  issues: string[];
  digest: string | null;
}

export interface ArchiveReport {
  feature: string;
  capabilities: string[];
  added: number;
  modified: number;
  removed: number;
  converged: boolean;
}

export interface ArchiveResult {
  action: ActionPacket;
  report: ArchiveReport;
}

export interface IntegrationInput {
  revision: number;
  targetRoot: string;
  actor?: string;
}

export interface IntegrationResult extends ArchiveResult {
  receipt: Record<string, unknown>;
}

export interface DeliveryCommitInput {
  branch: string;
  paths: string[];
  message: string;
  title: string;
  body: string;
}

export interface DeliveryInput {
  revision: number;
  source: DeliveryCommitInput;
  evidence: DeliveryCommitInput;
  actor?: string;
}

export interface DeliveryResult {
  action: ActionPacket;
  receipt: Record<string, unknown>;
}

export interface PublicationInput {
  revision: number;
  authorization: StandingAuthorization;
  packageName: string;
  version: string;
  distTag: string;
  commit: string;
  approved: true;
  actor?: string;
}

export interface PublicationResult {
  action: ActionPacket;
  receipt: Record<string, unknown>;
}

export interface TransitionEvent {
  schemaVersion: typeof SCHEMA_VERSION;
  revision: number;
  previousRevision: number;
  actor: string;
  summary: string;
  createdAt: string;
  state: WorkflowState;
}

export interface IntegrationReport {
  scope: "project" | "global";
  selected: import("./agent-catalog.js").AgentSkillTargetId[];
  destinations: string[];
  created: string[];
  updated: string[];
  removed: string[];
  preserved: string[];
  entrypoints: AgentEntrypointReport[];
}

export interface UninstallReport {
  package: "removed";
  integrations: IntegrationReport;
  preserved: {
    projectHistory: true;
    repositoryIntegrations: true;
  };
}

export type AgentIntegrationId = "codex" | "claude" | "cursor" | "gemini" | "windsurf";

export interface AgentEntrypointReport {
  id: import("./agent-catalog.js").AgentSkillTargetId;
  agent: string;
  kind: "skill" | "slash-command";
  artifactRoot: string;
  skills: string[];
  invocations: string[];
  reload: string;
  guidanceVerified: boolean;
  projectMcp: boolean;
  handoff: boolean;
}

export type AgentLaunchCapability = "prompt" | "workspace";

export interface DetectedAgent {
  id: AgentIntegrationId;
  agent: string;
  executable: string;
  capability: AgentLaunchCapability;
}

export interface AgentHandoffOption extends DetectedAgent {
  feature: string;
  specification: string;
  cwd: string;
  prompt: string;
  argv: string[];
  approvalToken: string;
}

export interface AgentHandoffOffer {
  kind: "agent_handoff_offer";
  protocol: "empirical-sdd";
  schemaVersion: typeof SCHEMA_VERSION;
  root: string;
  feature: string;
  specification: string;
  choices: ["current", "save", "agent"];
  agents: AgentHandoffOption[];
  requiresApproval: true;
}

export interface AuthorizedAgentHandoff {
  kind: "authorized_agent_handoff";
  protocol: "empirical-sdd";
  schemaVersion: typeof SCHEMA_VERSION;
  root: string;
  feature: string;
  agent: AgentIntegrationId;
  cwd: string;
  argv: string[];
  prompt: string;
}

export interface RepositoryKnowledgeFile {
  path: string;
  size: number;
  digest: string;
}

export interface RepositoryKnowledgePage {
  path: string;
  generator: string;
  managed: boolean;
  dependencies: string[];
  sourceDigest: string;
  digest: string | null;
  freshness: "fresh" | "stale" | "missing";
}

export interface RepositoryKnowledgeManifest {
  schemaVersion: 2;
  generator: string;
  sourceDigest: string;
  digest: string;
  files: RepositoryKnowledgeFile[];
  pages: RepositoryKnowledgePage[];
  truncated: boolean;
}

export interface RepositoryKnowledgeReport {
  root: string;
  status: "created" | "refreshed" | "current" | "stale";
  digest: string;
  files: number;
  truncated: boolean;
  manifest: string;
  context: string[];
  stale: string[];
  missing: string[];
  refinementRequired: string[];
}

export interface InitOptions extends ProjectConfigurationInput {
  profile?: Workflow;
  integrations?: boolean;
  tracker?: TrackerSetupChange;
  trackerDependencies?: TrackerDependencies;
}

export interface StartOptions {
  profile?: Workflow;
  id?: string;
}

export interface FeatureStartOptions {
  id?: string;
}

export interface YoloOptions extends FeatureStartOptions {
  ceiling?: "implemented" | "verified" | "integrated" | "delivered" | "published";
  targetBranch?: string;
  allowExternalAgent?: boolean;
}

export interface ExecuteEvidenceInput {
  commandId: string;
  criteria: string[];
  evidenceKinds?: EvidenceKind[];
  summary: string;
}

export interface CollectEvidenceInput {
  criteria: string[];
  evidenceKinds: EvidenceKind[];
  summary: string;
  collector: string;
  artifacts: Array<{ path: string; mediaType: string }>;
}

export interface AdoptionOptions extends ProjectConfigurationInput {
  profile?: Workflow;
  integrations?: boolean;
}

export interface ValidationReport {
  valid: boolean;
  phase: Phase;
  criteria: number;
  missing: string[];
}
