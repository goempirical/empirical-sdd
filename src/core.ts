import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { EmpiricalError } from "./errors.js";
import { buildHandoffOption, detectSupportedAgents } from "./agents.js";
import { installProjectIntegrations } from "./integrations.js";
import {
  freshRepositoryKnowledgePaths,
  inspectRepositoryKnowledge,
  refreshRepositoryKnowledge,
} from "./knowledge.js";
import { ProjectStore, discoverProject, isFile, readJson, writeJsonAtomic } from "./storage.js";
import { createDecisionTemplate, requireValidDecisions, validateDecisions } from "./decisions.js";
import {
  buildRefinedRequest,
  createDiscoveryRecord,
  loadDiscovery,
  nextSocraticPrompt,
  saveDiscovery,
  validateMaterialFollowUps,
  validateSocraticAnswers,
  type DiscoveryRecord,
  type DiscoverySubmission,
  type DiscoverySubmissionResult,
} from "./discovery.js";
import { createGitWorktree, featureSlug, proposeWorktree as buildWorktreeProposal } from "./worktrees.js";
import {
  createAuthorization,
  createImpactManifest,
  deriveCompletion,
  digestJson,
  sha256,
  verifyImpactManifest,
  verifyAuthorization,
  type EvidenceReceipt,
  type ImpactManifest,
  type StandingAuthorization,
} from "./protocol.js";
import { routeRequest } from "./routing.js";
import {
  appendReceipt,
  createCollectedReceipt,
  createExecutedReceipt,
  readAndValidateReceipt,
  receiptParent,
  receiptPath,
  repositoryTreeDigest,
} from "./evidence.js";
import { executeCommand, executeCommandCaptured } from "./runtime.js";
import {
  captureCapabilityBases,
  claimCapabilities,
  integrateCapabilities,
  inspectCapabilityClaims,
  resolveGitRepositoryIdentity,
  verifyIntegrationReceipt,
  type IntegrationReceipt,
} from "./coordination.js";
import { doctorRepository } from "./doctor.js";
import {
  deliverToGitHub,
  publicationRequestDigest,
  publishImmutable,
  verifyDeliveryReceipt,
  verifyPublicationReceipt,
  type GitHubDeliveryReceipt,
  type PublicationReceipt,
} from "./delivery.js";
import { parsePolicy } from "./policy.js";
import { isMigrationScratchPath } from "./migration-scratch.js";
import {
  bindTracker,
  configureTrackerPolicy,
  discoverTracker,
  loadTrackerPolicy,
  parseTrackerSetupChange,
  previewTrackerPolicy,
  proposeTrackerStateMapping,
  synchronizeTracker,
  trackerStatus,
} from "./tracking.js";
import {
  capabilityDeltaDigest,
  capabilityMarkdownDigest,
  listCapabilities,
  loadCapabilityDeltas,
  validateFeatureDeltas,
} from "./specifications.js";
import {
  PRODUCT_VERSION,
  SCHEMA_VERSION,
  type ActionPacket,
  type ActionRationale,
  type AdoptionOptions,
  type AgentHandoffOffer,
  type AgentIntegrationId,
  type AuthorizedAgentHandoff,
  type ArchiveResult,
  type CapabilityDelta,
  type CapabilitySummary,
  type CompletionInput,
  type CollectEvidenceInput,
  type Criterion,
  type DeliveryInput,
  type DeliveryResult,
  type EvidenceKind,
  type ExecuteEvidenceInput,
  type ExplainReport,
  type ExplorationPacket,
  type FeatureStartResult,
  type FeatureStartOptions,
  type InitOptions,
  type IntegrationReport,
  type IntegrationResult,
  type Phase,
  type Profile,
  type ProjectConfig,
  type ProjectPolicy,
  type ProjectStatus,
  type ProjectConfigurationInput,
  type PublicationInput,
  type PublicationResult,
  type StartOptions,
  type TrackerBindInput,
  type TrackerBindResult,
  type TrackerDependencies,
  type TrackerDiscovery,
  type TrackerDiscoveryInput,
  type TrackerPolicy,
  type TrackerPolicyPreview,
  type TrackerMappingSuggestion,
  type TrackerStatus,
  type TrackerSyncResult,
  type ValidationReport,
  type Workflow,
  type WorkflowState,
  type WorktreeCreateInput,
  type WorktreeHandoff,
  type WorktreeProposal,
  type YoloOptions,
} from "./types.js";

const FAST_PHASES: Phase[] = ["implement", "context", "done"];
const QUICK_PHASES: Phase[] = ["shape", "implement", "context", "verify", "review", "done"];
const COMPLEX_PHASES: Phase[] = [
  "specify",
  "design",
  "plan",
  "implement",
  "context",
  "verify",
  "review",
  "integrate",
  "done",
];

interface PhaseApproval {
  deltaDigest: string | null;
  impactDigest: string | null;
  capabilityClaimId: string | null;
  behavioral: boolean | null;
}

export class EmpiricalProject {
  /** @internal Repository adapter for first-party transports and tests. */
  store: ProjectStore;
  private readonly readOnly: boolean;

  private constructor(store: ProjectStore, readOnly = false) {
    this.store = store;
    this.readOnly = readOnly;
  }

  static async open(start = process.cwd(), options: { migrate?: boolean; feature?: string } = {}): Promise<EmpiricalProject> {
    const base = await discoverProject(start);
    const migrate = options.migrate !== false;
    if (migrate) await base.migrateSchema();
    if (options.feature) {
      const scoped = base.forFeature(options.feature);
      await scoped.assertFeaturePathSafe(options.feature, [scoped.statePath, scoped.eventsDirectory]);
      if (!(await isFile(scoped.statePath))) {
        throw new EmpiricalError("FEATURE_NOT_FOUND", `Feature ${options.feature} has no workflow state`);
      }
      await scoped.loadState(migrate);
      return new EmpiricalProject(scoped);
    }
    const active = await base.activeFeature(migrate);
    return new EmpiricalProject(active ? base.forFeature(active) : base);
  }

  static async openReadOnly(start = process.cwd()): Promise<EmpiricalProject> {
    const base = await discoverProject(start);
    await base.assertCurrentSchemaReadOnly();
    const active = await base.activeFeature(false);
    return new EmpiricalProject(active ? base.forFeature(active) : base, true);
  }

  static async initialize(
    root = process.cwd(),
    options: InitOptions = {},
  ): Promise<{ project: EmpiricalProject; state: WorkflowState; integrations: IntegrationReport }> {
    const absoluteRoot = resolve(root);
    const trackerChange = options.tracker ? parseTrackerSetupChange(options.tracker) : undefined;
    if (trackerChange?.mode === "apply") {
      await previewTrackerPolicy(
        trackerChange.policy,
        withTrackerRepositoryRoot(options.trackerDependencies ?? {}, absoluteRoot),
      );
    }
    await mkdir(absoluteRoot, { recursive: true });
    const store = new ProjectStore(absoluteRoot);
    if (await store.exists()) {
      const integrations = options.integrations === false
        ? emptyIntegrationReport()
        : await installProjectIntegrations(absoluteRoot);
      await store.migrateSchema();
      const active = await store.activeFeature();
      const project = new EmpiricalProject(active ? store.forFeature(active) : store);
      const explicitConfiguration = initializationConfiguration(options);
      if (explicitConfiguration) {
        const current = await project.config();
        await project.configure({
          ...explicitConfiguration,
          setupComplete: explicitConfiguration.setupComplete ?? current.setupComplete,
        });
      }
      await applyTrackerSetup(project, options);
      await refreshRepositoryKnowledge(absoluteRoot);
      return { project, state: await project.store.loadState(), integrations };
    }
    if (await isFile(join(absoluteRoot, "ai", "STATE.md"))) {
      throw new EmpiricalError(
        "LEGACY_PROJECT",
        "An Empirical v1 ai/ workspace already exists; use an installed Empirical agent skill to adopt it",
      );
    }
    const profile = options.profile ?? "complex";
    assertWorkflow(profile);
    const config = defaultConfig(profile, null, options);
    const state = initialState(profile);
    await store.writeInitial(config);
    const initialPolicy = await store.loadPolicy();
    await store.writePolicy({
      ...initialPolicy,
      verification: {
        ...initialPolicy.verification,
        evidence: { ...config.evidence },
      },
    });
    const project = new EmpiricalProject(store);
    await applyTrackerSetup(project, options);
    const integrations = options.integrations === false
      ? emptyIntegrationReport()
      : await installProjectIntegrations(absoluteRoot);
    await refreshRepositoryKnowledge(absoluteRoot);
    return { project, state, integrations };
  }

  static async adopt(
    root = process.cwd(),
    options: AdoptionOptions = {},
  ): Promise<{ project: EmpiricalProject; state: WorkflowState; integrations: IntegrationReport }> {
    const absoluteRoot = resolve(root);
    const store = new ProjectStore(absoluteRoot);
    if (await store.exists()) {
      const integrations = options.integrations === false
        ? emptyIntegrationReport()
        : await installProjectIntegrations(absoluteRoot);
      await store.migrateSchema();
      await refreshRepositoryKnowledge(absoluteRoot);
      const active = await store.activeFeature();
      const project = new EmpiricalProject(active ? store.forFeature(active) : store);
      return { project, state: await project.store.loadState(), integrations };
    }
    const legacyStatePath = join(absoluteRoot, "ai", "STATE.md");
    if (!(await isFile(legacyStatePath))) {
      throw new EmpiricalError(
        "LEGACY_NOT_FOUND",
        "No ai/STATE.md was found; use the Empirical Init or automatic agent skill for a new repository",
      );
    }
    const legacy = await readFile(legacyStatePath, "utf8");
    const feature = legacyField(legacy, "current_spec") ?? legacyField(legacy, "currentSpec");
    const legacyPhase = legacyField(legacy, "current_phase")
      ?? legacyField(legacy, "currentPhase")
      ?? legacyField(legacy, "phase");
    const profile = options.profile ?? "complex";
    assertWorkflow(profile);
    const phase = feature ? mapLegacyPhase(legacyPhase, profile) : "idle";
    const now = new Date().toISOString();
    const state: WorkflowState = {
      ...initialState(profile),
      activeFeature: feature,
      phase,
      status: phase === "idle" ? "idle" : phase === "done" ? "done" : "waiting",
      updatedAt: now,
      message: "Adopted non-destructively from ai/",
    };
    const adoptedConfig = defaultConfig(profile, "ai", options);
    await store.writeInitial(adoptedConfig);
    const adoptedPolicy = await store.loadPolicy();
    await store.writePolicy({
      ...adoptedPolicy,
      verification: {
        ...adoptedPolicy.verification,
        evidence: { ...adoptedConfig.evidence },
      },
    });
    if (feature) {
      const legacySpec = join(absoluteRoot, "ai", "specs", feature, "spec.md");
      if (await isFile(legacySpec)) {
        await store.writeSpec(feature, await readFile(legacySpec, "utf8"));
      } else {
        const request = `Adopted v1 feature ${feature}`;
        await store.writeSpec(
          feature,
          profile === "fast" ? renderFastSpec(feature, request) : renderSpec(feature, request),
        );
      }
      await store.forFeature(feature).writeInitialFeature(state, "empirical-adopt", "Adopted Empirical v1 state");
    }
    const integrations = options.integrations === false
      ? emptyIntegrationReport()
      : await installProjectIntegrations(absoluteRoot);
    await refreshRepositoryKnowledge(absoluteRoot);
    const project = new EmpiricalProject(feature ? store.forFeature(feature) : store);
    return { project, state, integrations };
  }

  async status(): Promise<WorkflowState> {
    return this.store.loadState(!this.readOnly);
  }

  async statusReport(): Promise<ProjectStatus> {
    const state = await this.store.loadState(!this.readOnly);
    return { ...state, tracker: await trackerStatus(this.store.root, state) };
  }

  async trackerPolicy(): Promise<TrackerPolicy | null> {
    return loadTrackerPolicy(this.store.root);
  }

  async configureTracker(
    value: unknown,
    dependencies: TrackerDependencies = {},
  ): Promise<TrackerPolicy | null> {
    if (this.readOnly) throw new EmpiricalError("READ_ONLY", "Tracker configuration requires a writable project");
    return configureTrackerPolicy(this.store.root, value, withTrackerRepositoryRoot(dependencies, this.store.root));
  }

  async discoverTracker(
    input: TrackerDiscoveryInput,
    dependencies: TrackerDependencies = {},
  ): Promise<TrackerDiscovery> {
    return discoverTracker(input, withTrackerRepositoryRoot(dependencies, this.store.root));
  }

  async previewTracker(
    value: unknown,
    dependencies: TrackerDependencies = {},
  ): Promise<TrackerPolicyPreview> {
    return previewTrackerPolicy(value, withTrackerRepositoryRoot(dependencies, this.store.root));
  }

  async proposeTrackerMapping(
    value: unknown,
    dependencies: TrackerDependencies = {},
  ): Promise<TrackerMappingSuggestion> {
    return proposeTrackerStateMapping(value, withTrackerRepositoryRoot(dependencies, this.store.root));
  }

  async bindTracker(
    input: TrackerBindInput,
    dependencies: TrackerDependencies = {},
  ): Promise<TrackerBindResult> {
    if (this.readOnly) throw new EmpiricalError("READ_ONLY", "Tracker binding requires a writable project");
    return bindTracker(this.store.root, await this.store.loadState(), input, dependencies);
  }

  async syncTracker(dependencies: TrackerDependencies = {}): Promise<TrackerSyncResult> {
    if (this.readOnly) throw new EmpiricalError("READ_ONLY", "Tracker synchronization requires a writable project");
    return synchronizeTracker(this.store.root, await this.store.loadState(), dependencies);
  }

  async config(): Promise<ProjectConfig> {
    return this.store.loadConfig();
  }

  async configure(input: ProjectConfigurationInput): Promise<ProjectConfig> {
    const current = await this.store.loadConfig();
    const configured = await this.store.configure({
      ...current,
      evidence: { ...current.evidence, ...input.evidence },
      isolation: { ...current.isolation, ...input.isolation },
      decisions: { ...current.decisions, ...input.decisions },
      setupComplete: input.setupComplete ?? true,
    });
    const policy = await this.store.loadPolicy();
    await this.store.writePolicy({
      ...policy,
      verification: {
        ...policy.verification,
        evidence: { ...configured.evidence },
      },
    });
    return configured;
  }

  async policy(): Promise<ProjectPolicy> {
    return this.store.loadPolicy();
  }

  async configurePolicy(value: unknown): Promise<ProjectPolicy> {
    if (this.readOnly) throw new EmpiricalError("READ_ONLY", "Policy configuration requires a writable project");
    const policy = parsePolicy(value, this.store.root) as ProjectPolicy;
    await this.store.writePolicy(policy);
    await this.store.configure({ evidence: { ...policy.verification.evidence } } as Partial<ProjectConfig>);
    return policy;
  }

  async explore(problem: string): Promise<ExplorationPacket> {
    const cleanProblem = problem.trim();
    if (!cleanProblem) throw new EmpiricalError("REQUEST_REQUIRED", "A non-empty problem is required");
    const policy = await this.store.loadPolicy();
    const capabilities = await listCapabilities(this.store);
    return {
      protocol: "empirical-sdd",
      schemaVersion: SCHEMA_VERSION,
      root: this.store.root,
      problem: cleanProblem,
      instructions: [
        "Use the current host agent only. Inspect the relevant code and living capability specifications; do not write implementation code yet.",
        "Identify the observed problem, affected users, current behavior, smallest useful outcome, constraints, risks, and two or three viable approaches.",
        "Ask only questions whose answers materially change scope or architecture, then restate the refined request in observable terms.",
        "Choose Fast only when the refined change is explicit, tiny, localized, reversible, low-risk, and non-UI; choose Complex otherwise.",
      ],
      questions: [
        "Who experiences the problem and what observable behavior should change?",
        "What is the smallest useful outcome, and what is explicitly out of scope?",
        "Which assumption, dependency, or risk could change the implementation approach?",
      ],
      projectContext: policy.context,
      knowledgeContext: await existingKnowledgePaths(this.store.root),
      capabilityContext: capabilities.map((capability) => capability.path),
      next: {
        fast: `empirical __internal fast ${JSON.stringify(cleanProblem)}`,
        complex: `empirical __internal complex ${JSON.stringify(cleanProblem)}`,
      },
    };
  }

  async discovery(input: DiscoverySubmission): Promise<DiscoverySubmissionResult> {
    if (this.readOnly) {
      throw new EmpiricalError("READ_ONLY", "Socratic discovery persistence requires a writable project");
    }
    if (!input || typeof input !== "object") {
      throw new EmpiricalError("INVALID_DISCOVERY", "Discovery input must be an object");
    }
    if (input.approved !== undefined && input.approved !== true) {
      throw new EmpiricalError("INVALID_DISCOVERY", "Discovery approval must be literal true when supplied");
    }
    if (input.id !== undefined && (typeof input.id !== "string" || !input.id.trim())) {
      throw new EmpiricalError("INVALID_DISCOVERY", "Discovery id must be a non-empty string when supplied");
    }
    const problem = typeof input.problem === "string" ? input.problem.trim() : "";
    if (!problem) throw new EmpiricalError("REQUEST_REQUIRED", "A non-empty problem is required");
    const answers = validateSocraticAnswers(input.answers, { complete: input.approved === true });
    validateMaterialFollowUps(problem, answers, { complete: input.approved === true });
    let record = input.id
      ? await loadDiscovery(this.store.root, input.id)
      : createDiscoveryRecord(problem);
    if (record.problem !== problem) {
      throw new EmpiricalError(
        "DISCOVERY_MISMATCH",
        `Discovery '${record.id}' belongs to a different problem`,
      );
    }
    if (record.status === "draft" && !extendsDiscoveryAnswers(record.answers, answers)) {
      throw new EmpiricalError(
        "DISCOVERY_MISMATCH",
        `Discovery '${record.id}' answers must extend the saved draft without changing it`,
      );
    }
    if (record.status !== "draft" && !sameDiscoveryAnswers(record.answers, answers)) {
      throw new EmpiricalError(
        "DISCOVERY_IMMUTABLE",
        `Discovery '${record.id}' cannot change after approval`,
      );
    }
    if (
      record.status !== "draft"
      && record.refinedRequest !== buildRefinedRequest(problem, answers)
    ) {
      throw new EmpiricalError(
        "DISCOVERY_MISMATCH",
        `Discovery '${record.id}' refined request does not match its approved answers`,
      );
    }
    if (record.status === "started") {
      if (input.approved !== true) {
        throw new EmpiricalError(
          "DISCOVERY_IMMUTABLE",
          `Discovery '${record.id}' has already started`,
        );
      }
      const state = await this.status();
      if (!record.handoff || state.activeFeature !== record.handoff.feature) {
        throw new EmpiricalError(
          "DISCOVERY_NOT_ACTIVE",
          `Discovery '${record.id}' is not the selected workflow in this checkout`,
        );
      }
      const paths = await saveDiscovery(this.store.root, record);
      return {
        record,
        paths,
        refinedRequest: record.refinedRequest,
        nextQuestion: null,
        start: await this.next(),
      };
    }

    const nextQuestion = nextSocraticPrompt(problem, answers);
    const refinedRequest = answers.length === 5 && nextQuestion === null
      ? buildRefinedRequest(problem, answers)
      : null;
    if (record.status === "draft") {
      record = touchDiscoveryRecord(record, { answers, refinedRequest });
    }
    let paths = await saveDiscovery(this.store.root, record);
    if (input.approved !== true) {
      return { record, paths, refinedRequest: record.refinedRequest, nextQuestion, start: null };
    }

    if (!refinedRequest) {
      throw new EmpiricalError("INVALID_DISCOVERY", "Approved discovery requires all five answers");
    }
    if (record.status === "draft" || record.workflow !== "complex") {
      record = touchDiscoveryRecord(record, {
        status: "approved",
        refinedRequest,
        approvedAt: record.approvedAt ?? new Date().toISOString(),
        workflow: "complex",
      });
      paths = await saveDiscovery(this.store.root, record);
    }
    const start = await this.complex(refinedRequest);
    if (start.kind === "action") {
      record = touchDiscoveryRecord(record, {
        status: "started",
        workflow: "complex",
        handoff: { feature: start.feature ?? "unknown", revision: start.revision },
      });
      paths = await saveDiscovery(this.store.root, record);
    }
    return { record, paths, refinedRequest, nextQuestion: null, start };
  }

  async capabilities(): Promise<CapabilitySummary[]> {
    return listCapabilities(this.store);
  }

  route(
    request: string,
    options: { mode?: "normal" | "yolo"; requestedProfile?: Workflow; declaredContractNeutral?: boolean } = {},
  ) {
    return routeRequest({ request, ...options });
  }

  async context() {
    if (this.readOnly) {
      throw new EmpiricalError("READ_ONLY", "Repository knowledge refresh requires a writable project");
    }
    return refreshRepositoryKnowledge(this.store.root);
  }

  async executeEvidence(input: ExecuteEvidenceInput): Promise<EvidenceReceipt> {
    const state = await this.store.loadState();
    this.assertEvidencePhase(state);
    const policy = await this.store.loadPolicy();
    const command = policy.verification.commands.find((entry) => entry.id === input.commandId);
    if (!command) {
      throw new EmpiricalError(
        "COMMAND_NOT_CONFIGURED",
        `Policy v2 does not define verification command '${input.commandId}'`,
      );
    }
    const criteria = await this.validateEvidenceCriteria(state, input.criteria);
    if (
      command.criteria.length > 0 &&
      criteria.some((criterion) => !command.criteria.includes(criterion))
    ) {
      throw new EmpiricalError(
        "INVALID_EVIDENCE",
        `Command ${command.id} is not configured for every requested criterion`,
      );
    }
    const evidenceKinds = input.evidenceKinds ?? command.evidenceKinds;
    const unauthorizedKinds = evidenceKinds.filter(
      (kind) => !command.evidenceKinds.includes(kind),
    );
    if (unauthorizedKinds.length > 0) {
      throw new EmpiricalError(
        "INVALID_EVIDENCE",
        `Command ${command.id} is not authorized for evidence kinds: ${[...new Set(unauthorizedKinds)].join(", ")}`,
      );
    }
    const result = await executeCommand(this.store.root, {
      argv: [...command.argv],
      cwd: command.cwd,
      timeoutMs: command.timeoutMs,
      maxOutputBytes: command.maxOutputBytes,
    });
    const receipt = createExecutedReceipt({
      criteria,
      evidenceKinds,
      summary: input.summary,
      provenance: await this.evidenceProvenance(state),
      result,
    });
    const path = receiptPath(this.store.specDirectory(state.activeFeature!), receipt);
    await mkdir(receiptParent(path), { recursive: true });
    await appendReceipt(path, receipt);
    return receipt;
  }

  async collectEvidence(input: CollectEvidenceInput): Promise<EvidenceReceipt> {
    const state = await this.store.loadState();
    this.assertEvidencePhase(state);
    const criteria = await this.validateEvidenceCriteria(state, input.criteria);
    const receipt = await createCollectedReceipt({
      root: this.store.root,
      criteria,
      evidenceKinds: input.evidenceKinds,
      summary: input.summary,
      collector: input.collector,
      provenance: await this.evidenceProvenance(state),
      artifacts: input.artifacts,
    });
    const path = receiptPath(this.store.specDirectory(state.activeFeature!), receipt);
    await mkdir(receiptParent(path), { recursive: true });
    await appendReceipt(path, receipt);
    return receipt;
  }

  async handoff(): Promise<AgentHandoffOffer> {
    const state = await this.store.loadState(!this.readOnly);
    if (!state.activeFeature || state.profile !== "complex" || ["idle", "specify", "done"].includes(state.phase)) {
      throw new EmpiricalError(
        "HANDOFF_NOT_READY",
        "Agent handoff is available only after a Complex specification has passed",
      );
    }
    const specification = this.store.specPath(state.activeFeature);
    const specDigest = digest(await this.store.readSpec(state.activeFeature));
    const agents = await detectSupportedAgents({ includeConfigured: false });
    return {
      kind: "agent_handoff_offer",
      protocol: "empirical-sdd",
      schemaVersion: SCHEMA_VERSION,
      root: this.store.root,
      feature: state.activeFeature,
      specification,
      choices: ["current", "save", "agent"],
      agents: agents.map((agent) => buildHandoffOption({
        root: this.store.root,
        feature: state.activeFeature!,
        specification,
        specDigest,
        agent,
      })),
      requiresApproval: true,
    };
  }

  async authorizeHandoff(
    agent: AgentIntegrationId,
    approvalToken: string,
    approved: boolean,
  ): Promise<AuthorizedAgentHandoff> {
    if (approved !== true) {
      throw new EmpiricalError("HANDOFF_APPROVAL_REQUIRED", "Agent handoff requires explicit approval");
    }
    const offer = await this.handoff();
    const option = offer.agents.find((candidate) => candidate.id === agent);
    if (!option) throw new EmpiricalError("AGENT_NOT_DETECTED", `Agent ${agent} is not currently detected`);
    if (option.approvalToken !== approvalToken) {
      throw new EmpiricalError("STALE_HANDOFF_PROPOSAL", "The approved agent handoff changed; review a new proposal");
    }
    return {
      kind: "authorized_agent_handoff",
      protocol: "empirical-sdd",
      schemaVersion: SCHEMA_VERSION,
      root: offer.root,
      feature: offer.feature,
      agent,
      cwd: option.cwd,
      argv: [...option.argv],
      prompt: option.prompt,
    };
  }

  async capability(name: string): Promise<string | null> {
    return this.store.readCapability(name);
  }

  async start(request: string, options: StartOptions = {}): Promise<FeatureStartResult> {
    const cleanRequest = request.trim();
    if (!cleanRequest) {
      throw new EmpiricalError("REQUEST_REQUIRED", "A non-empty feature request is required");
    }
    const configuredProfile = (await this.store.loadConfig()).profile;
    const requestedProfile = options.profile ?? (configuredProfile === "quick" ? "complex" : configuredProfile);
    assertWorkflow(requestedProfile);
    const routing = routeRequest({
      request: cleanRequest,
      requestedProfile,
      ...(requestedProfile === "fast" ? { declaredContractNeutral: true } : {}),
    });
    const profile = routing.profile;
    const base = new ProjectStore(this.store.root);
    const active = await base.activeFeature();
    if (active) {
      const current = await base.forFeature(active).loadState();
      if (current.request?.trim() === cleanRequest) {
        this.store = base.forFeature(active);
        return assertStartAction(await this.next(), cleanRequest, profile, options);
      }
      return this.proposeWorktree(cleanRequest, profile, { ...(options.id ? { feature: options.id } : {}) });
    }
    const started = await base.withResourceLock("specs", async () => {
      const raced = await base.activeFeature();
      if (raced) {
        const current = await base.forFeature(raced).loadState();
        if (current.request?.trim() === cleanRequest) {
          return { existing: true as const, store: base.forFeature(raced), state: current, spec: await base.readSpec(raced) };
        }
        return { proposal: await this.proposeWorktree(cleanRequest, profile, { ...(options.id ? { feature: options.id } : {}) }) };
      }
      const feature = options.id ?? featureSlug(cleanRequest);
      if ((await base.listFeatureIds()).includes(feature)) {
        throw new EmpiricalError("FEATURE_EXISTS", `Feature ${feature} already exists; choose a distinct --id`);
      }
      const spec = profile === "fast"
        ? renderFastSpec(titleFromFeature(feature), cleanRequest)
        : renderSpec(titleFromFeature(feature), cleanRequest);
      await base.writeSpec(feature, spec);
      if (profile === "complex") await createDecisionTemplate(base, feature);
      const impactPath = join(base.specDirectory(feature), "impact.json");
      const impact = profile === "fast"
        ? createImpactManifest({
            schemaVersion: 1,
            classification: "non-behavioral",
            capabilities: [],
            surfaces: ["contract-neutral-fast"],
            regressionRationale:
              "Fast is restricted to contract-neutral work proven by its generated criterion and focused regression receipts.",
          })
        : (() => {
            const body = {
              schemaVersion: 1,
              status: "draft",
              classification: "behavioral",
              capabilities: [] as string[],
              surfaces: ["workflow"],
              regressionRationale: null,
            };
            return { ...body, digest: digestJson(body) };
          })();
      await writeJsonAtomic(impactPath, impact);
      const state: WorkflowState = {
        ...initialState(profile),
        revision: 1,
        activeFeature: feature,
        request: cleanRequest,
        phase: firstPhase(profile),
        status: "waiting",
        specDigest: digest(spec),
        approvedSpecRevision: profile === "fast" ? 1 : null,
        capabilityArchiveRequired: profile === "complex",
        impactDigest: profile === "fast" ? impact.digest : null,
        updatedAt: new Date().toISOString(),
      };
      const scoped = base.forFeature(feature);
      await scoped.writeInitialFeature(state);
      return { existing: false as const, store: scoped, state, spec };
    });
    if ("proposal" in started) return started.proposal;
    this.store = started.store;
    return this.packet(started.state, parseCriteria(started.spec));
  }

  async fast(request: string, options: FeatureStartOptions = {}): Promise<FeatureStartResult> {
    return this.begin(request, "fast", options);
  }

  async complex(request: string, options: FeatureStartOptions = {}): Promise<FeatureStartResult> {
    return this.begin(request, "complex", options);
  }

  async yolo(request: string, options: YoloOptions = {}): Promise<FeatureStartResult> {
    const cleanRequest = request.trim();
    if (!cleanRequest) {
      throw new EmpiricalError("REQUEST_REQUIRED", "A non-empty feature request is required");
    }
    if (options.ceiling === "published") {
      throw new EmpiricalError(
        "PUBLICATION_AUTHORIZATION_REQUIRED",
        "YOLO never infers publication; use the explicit publish operation with an exact version",
      );
    }
    const routing = routeRequest({ request: cleanRequest, mode: "yolo" });
    const requestedCeiling = options.ceiling ?? "integrated";
    if (routing.profile === "fast" && requestedCeiling === "implemented") {
      throw new EmpiricalError(
        "YOLO_CEILING_UNREACHABLE",
        "Fast completion is atomic through verified; choose a verified ceiling or route the work through Complex",
      );
    }
    const policy = await this.store.loadPolicy();
    const targetBranch = options.targetBranch ?? policy.delivery?.targetBranch ?? null;
    if (requestedCeiling === "delivered" && (!policy.delivery || targetBranch === null)) {
      throw new EmpiricalError(
        "DELIVERY_POLICY_REQUIRED",
        "YOLO delivery requires Policy v2 GitHub delivery configuration and an exact target branch",
      );
    }
    const started = await this.begin(cleanRequest, routing.profile, {
      ...(options.id ? { id: options.id } : {}),
    });
    if (started.kind !== "action") return started;

    const state = await this.store.loadState();
    if (!state.activeFeature) {
      throw new EmpiricalError("NO_ACTIVE_PHASE", "YOLO authorization requires an active feature");
    }
    const ceiling = requestedCeiling;
    const repositoryId = await resolveGitRepositoryIdentity(this.store.root)
      .then((identity) => identity.repositoryId)
      .catch(() => sha256(resolve(this.store.root)));
    const candidate = createAuthorization({
      repositoryId,
      feature: state.activeFeature,
      requestDigest: sha256(cleanRequest),
      ceiling,
      targetBranch,
      allowExternalAgent: options.allowExternalAgent === true,
      createdAt: new Date().toISOString(),
      expiresAt: null,
    });
    const path = join(this.store.specDirectory(state.activeFeature), "authorization.json");
    const authorization = await readExistingAuthorization(path);
    if (authorization) {
      verifyAuthorization(authorization);
      const immutableFieldsMatch =
        authorization.repositoryId === candidate.repositoryId
        && authorization.feature === candidate.feature
        && authorization.requestDigest === candidate.requestDigest
        && authorization.ceiling === candidate.ceiling
        && authorization.targetBranch === candidate.targetBranch
        && authorization.allowExternalAgent === candidate.allowExternalAgent;
      if (!immutableFieldsMatch) {
        throw new EmpiricalError(
          "AUTHORIZATION_IMMUTABLE",
          "Standing authorization already exists and cannot be widened or replaced",
        );
      }
      if (state.mode === "yolo" && state.authorizationDigest === authorization.digest) {
        return this.packet(state, parseCriteria(await this.store.readSpec(state.activeFeature)));
      }
    } else {
      await writeJsonExclusive(path, candidate);
    }
    const accepted = authorization ?? candidate;
    const next = await this.store.transition(
      state.revision,
      "empirical-yolo",
      `Recorded standing authorization through ${accepted.ceiling}`,
      (current) => ({
        ...current,
        mode: "yolo",
        authorizationDigest: accepted.digest,
      }),
    );
    return this.packet(next, parseCriteria(await this.store.readSpec(next.activeFeature!)));
  }

  async loop(): Promise<ActionPacket> {
    if (arguments.length > 0) {
      throw new EmpiricalError(
        "INVALID_ARGUMENT",
        "Loop only resumes current work; start new work through empirical_fast or empirical_complex",
      );
    }
    return this.next();
  }

  private async begin(
    request: string,
    profile: "fast" | "complex",
    options: FeatureStartOptions,
  ): Promise<FeatureStartResult> {
    const base = new ProjectStore(this.store.root);
    const activeFeature = await base.activeFeature();
    const current = activeFeature ? await base.forFeature(activeFeature).loadState() : await base.loadState();
    const cleanRequest = request.trim();
    if (!cleanRequest) {
      throw new EmpiricalError("REQUEST_REQUIRED", "A non-empty feature request is required");
    }
    const routedProfile = routeRequest({
      request: cleanRequest,
      requestedProfile: profile,
      ...(profile === "fast" ? { declaredContractNeutral: true } : {}),
    }).profile;

    const currentRequest = current.request?.trim();
    const active = current.activeFeature !== null && current.phase !== "done";
    if (active) {
      if (currentRequest !== cleanRequest) {
        return this.proposeWorktree(cleanRequest, routedProfile, { ...(options.id ? { feature: options.id } : {}) });
      }
      if (routedProfile !== current.profile) {
        throw new EmpiricalError(
          "PROFILE_CONFLICT",
          `The active feature uses profile ${current.profile}, not ${routedProfile}`,
        );
      }
      if (options.id && options.id !== current.activeFeature) {
        throw new EmpiricalError(
          "FEATURE_ACTIVE",
          `The active feature is ${current.activeFeature}, not ${options.id}`,
        );
      }
      this.store = base.forFeature(current.activeFeature!);
      return assertStartAction(await this.next(), cleanRequest, routedProfile, options);
    }

    try {
      return await this.start(cleanRequest, { profile: routedProfile, ...options });
    } catch (error) {
      if (
        error instanceof EmpiricalError
        && (error.code === "FEATURE_ACTIVE" || error.code === "PROJECT_BUSY")
      ) {
        const latest = await EmpiricalProject.open(this.store.root);
        const action = await latest.next();
        if (action.request === cleanRequest) {
          this.store = latest.store;
          return assertStartAction(action, cleanRequest, routedProfile, options);
        }
      }
      throw error;
    }
  }

  async proposeWorktree(
    request: string,
    workflow: Workflow,
    overrides: {
      changeType?: "feature" | "fix" | "chore";
      feature?: string;
      branch?: string;
      path?: string;
      base?: string;
    } = {},
  ): Promise<WorktreeProposal> {
    const base = new ProjectStore(this.store.root);
    const activeFeature = await base.activeFeature(!this.readOnly);
    if (!activeFeature) {
      throw new EmpiricalError("WORKTREE_NOT_NEEDED", "This checkout has no active feature; start the request here");
    }
    const config = await base.loadConfig();
    if (config.isolation.mode === "off") {
      throw new EmpiricalError(
        "FEATURE_ACTIVE",
        `Feature ${activeFeature} is active and automatic worktree proposals are disabled`,
      );
    }
    return buildWorktreeProposal(
      base.root,
      request,
      workflow,
      activeFeature,
      config.isolation,
      overrides,
    );
  }

  async createWorktree(input: WorktreeCreateInput): Promise<WorktreeHandoff> {
    if (input.approved !== true) {
      throw new EmpiricalError("WORKTREE_APPROVAL_REQUIRED", "Worktree creation requires approved: true");
    }
    const proposal = await this.proposeWorktree(input.request, input.workflow, {
      ...(input.changeType ? { changeType: input.changeType } : {}),
      ...(input.feature ? { feature: input.feature } : {}),
      ...(input.branch ? { branch: input.branch } : {}),
      ...(input.path ? { path: input.path } : {}),
      ...(input.base ? { base: input.base } : {}),
    });
    if (proposal.activeFeature !== input.activeFeature) {
      throw new EmpiricalError(
        "STALE_WORKTREE_PROPOSAL",
        `The active feature changed from ${input.activeFeature} to ${proposal.activeFeature}; review a new proposal`,
      );
    }
    if (proposal.baseCommit !== input.baseCommit) {
      throw new EmpiricalError(
        "STALE_WORKTREE_PROPOSAL",
        `Base ${proposal.base} moved after approval; review a new proposal`,
      );
    }
    if (proposal.approvalToken !== input.approvalToken) {
      throw new EmpiricalError(
        "STALE_WORKTREE_PROPOSAL",
        "The approved worktree fields changed; review and approve a new proposal",
      );
    }
    await createGitWorktree(proposal);
    try {
      let project: EmpiricalProject;
      try {
        project = await EmpiricalProject.open(proposal.path);
      } catch (error) {
        if (!(error instanceof EmpiricalError) || error.code !== "PROJECT_NOT_INITIALIZED") throw error;
        project = (await EmpiricalProject.initialize(proposal.path, { integrations: false })).project;
      }
      const result = proposal.workflow === "fast"
        ? await project.fast(proposal.request, { id: proposal.feature })
        : await project.complex(proposal.request, { id: proposal.feature });
      if (result.kind !== "action") {
        throw new EmpiricalError(
          "WORKTREE_HANDOFF_FAILED",
          `The new checkout already contains active feature ${result.activeFeature}`,
        );
      }
      return {
        kind: "worktree_handoff",
        protocol: "empirical-sdd",
        schemaVersion: SCHEMA_VERSION,
        root: proposal.root,
        path: proposal.path,
        branch: proposal.branch,
        base: proposal.base,
        baseCommit: proposal.baseCommit,
        feature: result.feature!,
        revision: result.revision,
        workflow: proposal.workflow,
        resume: `cd ${JSON.stringify(proposal.path)} && empirical __internal loop`,
        action: result,
      };
    } catch (error) {
      throw new EmpiricalError(
        "WORKTREE_HANDOFF_FAILED",
        `Git created ${proposal.path}, but Empirical handoff failed: ${error instanceof Error ? error.message : String(error)}`,
        { path: proposal.path, branch: proposal.branch, base: proposal.base, baseCommit: proposal.baseCommit },
      );
    }
  }

  async explain(): Promise<ExplainReport> {
    const state = await this.store.loadState(!this.readOnly);
    const criteria = state.activeFeature
      ? parseCriteria(await this.store.readSpec(state.activeFeature))
      : [];
    const packet = await this.packet(state, criteria);
    const decisions = state.activeFeature && state.profile === "complex"
      ? (await validateDecisions(this.store, state.activeFeature, false)).decisions
          .filter((decision) => decision.status === "Accepted")
      : [];
    return {
      protocol: "empirical-sdd",
      schemaVersion: SCHEMA_VERSION,
      root: this.store.root,
      feature: state.activeFeature,
      phase: state.phase,
      status: state.status,
      revision: state.revision,
      rationale: packet.rationale,
      decisions,
      tracker: packet.tracker,
    };
  }

  async next(): Promise<ActionPacket> {
    const state = await this.store.loadState(!this.readOnly);
    const criteria = state.activeFeature
      ? parseCriteria(await this.store.readSpec(state.activeFeature))
      : [];
    return this.packet(state, criteria);
  }

  async complete(input: CompletionInput): Promise<ActionPacket> {
    assertCompletionInput(input);
    const summary = input.summary.trim();
    if (!summary) throw new EmpiricalError("SUMMARY_REQUIRED", "Completion summary cannot be blank");
    const actor = input.actor?.trim() || "agent";
    const completed = await this.store.transaction(async (current) => {
      if (input.revision !== current.revision) {
        throw new EmpiricalError(
          "STALE_REVISION",
          `Expected revision ${input.revision}, but the project is at ${current.revision}`,
        );
      }
      if (!current.activeFeature || current.phase === "idle" || current.phase === "done") {
        throw new EmpiricalError("NO_ACTIVE_PHASE", "There is no active phase to complete");
      }
      if (["integrate", "deliver", "publish", "archive"].includes(current.phase)) {
        throw new EmpiricalError(
          "SPECIAL_OPERATION_REQUIRED",
          `Use empirical_${current.phase === "archive" ? "integrate" : current.phase} for the exact ${current.phase} revision`,
        );
      }
      if (current.status === "blocked") {
        throw new EmpiricalError("WORKFLOW_BLOCKED", "Resolve the blocker and call empirical_retry");
      }
      if (current.status === "awaiting_human") {
        throw new EmpiricalError("AWAITING_HUMAN", "Call empirical_retry after the decision is provided");
      }
      const specBefore = await this.store.readSpec(current.activeFeature);
      const specBeforeDigest = digest(specBefore);
      if (
        current.specDigest
        && current.specDigest !== specBeforeDigest
        && current.phase !== "shape"
        && current.phase !== "specify"
      ) {
        throw new EmpiricalError(
          "SPEC_CHANGED",
          "The specification changed after it was approved; restore it or start a new feature",
        );
      }
      await this.assertCapabilityDeltasUnchanged(current);
      const criteria = parseCriteria(specBefore);
      const config = await this.store.loadConfig();
      const receiptIds = [
        ...current.evidenceReceiptIds,
        ...(input.receiptIds ?? []),
      ];
      let approval: PhaseApproval = {
        deltaDigest: null,
        impactDigest: null,
        capabilityClaimId: null,
        behavioral: null,
      };
      if (input.outcome === "passed") {
        approval = await this.validatePhasePass(
          current,
          input,
          criteria,
          config,
          receiptIds,
        );
      }
      const state = structuredClone(current);
      state.specDigest = specBeforeDigest;
      if (input.outcome === "awaiting_human") {
        state.status = "awaiting_human";
        state.message = summary;
      } else if (input.outcome === "blocked") {
        state.status = "blocked";
        state.message = summary;
      } else if (input.outcome === "failed") {
        routeFailure(state, summary, config.maxRepairAttempts);
      } else {
        if (current.phase === "specify") {
          state.capabilityArchiveRequired = approval.behavioral === true;
          state.capabilityDeltaDigest = approval.deltaDigest;
          state.impactDigest = approval.impactDigest;
          state.capabilityClaimId = approval.capabilityClaimId;
          state.approvedSpecRevision = current.revision + 1;
        }
        if (state.profile === "fast" && state.approvedSpecRevision === null) {
          state.approvedSpecRevision = state.revision;
        }
        if (state.phase === "implement") {
          state.implementationActor = actor;
          state.completion = deriveCompletion({
            ...state.completion,
            implemented: true,
            verified: state.profile === "fast",
          });
        }
        if (state.phase === "verify") {
          state.completion = deriveCompletion({
            ...state.completion,
            implemented: true,
            verified: true,
          });
        }
        state.evidenceReceiptIds = [...new Set(receiptIds)];
        if (state.phase === "implement") {
          const knowledge = await inspectRepositoryKnowledge(this.store.root);
          state.phase = knowledge.valid
            ? followingPhase(state.profile, "context")
            : "context";
        } else {
          state.phase = followingPhase(state.profile, state.phase);
        }
        state.status = state.phase === "done" ? "done" : "waiting";
        state.message = summary;
        if (state.phase === "done") state.repairAttempts = 0;
        if (
          state.mode === "yolo"
          && state.authorizationDigest
          && state.phase !== "done"
          && state.completion.highest !== "none"
        ) {
          const authorization = await readExistingAuthorization(
            join(this.store.specDirectory(state.activeFeature!), "authorization.json"),
          );
          if (!authorization) {
            throw new EmpiricalError(
              "AUTHORIZATION_CHANGED",
              "YOLO workflow state refers to a missing standing authorization",
            );
          }
          verifyAuthorization(authorization);
          if (authorization.digest !== state.authorizationDigest) {
            throw new EmpiricalError(
              "AUTHORIZATION_CHANGED",
              "The standing authorization no longer matches workflow state",
            );
          }
          if (completionRank(state.completion.highest) >= completionRank(authorization.ceiling)) {
            state.status = "awaiting_human";
            state.message = `YOLO authorization ceiling ${authorization.ceiling} reached`;
          }
        }
      }
      return {
        actor,
        summary,
        state,
        value: specBefore,
        validate: async () => {
          if (await this.store.readSpec(current.activeFeature!) !== specBefore) {
            throw new EmpiricalError(
              "SPEC_CHANGED",
              "The specification changed during completion; read the latest action and retry",
            );
          }
          if (
            approval.deltaDigest
            && await capabilityDeltaDigest(this.store, current.activeFeature!) !== approval.deltaDigest
          ) {
            throw new EmpiricalError(
              "DELTA_CHANGED",
              "Capability deltas changed during completion; read the latest action and retry",
            );
          }
        },
      };
    });
    if (completed.state.phase === "done" && completed.state.status === "done") {
      await this.store.compactTerminalJournal("empirical-complete");
    }
    return this.packet(completed.state, parseCriteria(completed.value));
  }

  async integrate(
    expectedRevision: number,
    targetRoot: string,
    actor = "agent",
  ): Promise<IntegrationResult> {
    const current = await this.store.loadState();
    if (!current.activeFeature) throw new EmpiricalError("NO_ACTIVE_PHASE", "There is no feature to integrate");
    const receiptPath = join(
      this.store.specDirectory(current.activeFeature),
      "integration-receipt.json",
    );
    if (
      current.phase === "done"
      && current.status === "done"
      && current.profile === "complex"
      && current.revision === expectedRevision + 1
      && current.message?.startsWith("Integrated")
    ) {
      const receipt = await readJson<Record<string, unknown>>(
        receiptPath,
        "INVALID_INTEGRATION_RECEIPT",
      );
      const deltas = await loadCapabilityDeltas(this.store, current.activeFeature);
      return {
        action: await this.next(),
        receipt,
        report: { ...archiveReport(current.activeFeature, deltas), converged: true },
      };
    }
    if (current.phase === "done" && current.status === "done") {
      throw new EmpiricalError(
        "STALE_REVISION",
        `Integration revision ${expectedRevision} does not identify the latest completed integration`,
      );
    }
    if (current.phase !== "integrate" || current.status !== "waiting") {
      throw new EmpiricalError("INTEGRATION_NOT_READY", "Complex work must pass review before integration");
    }
    if (current.revision !== expectedRevision) {
      throw new EmpiricalError(
        "STALE_REVISION",
        `Expected revision ${expectedRevision}, but the project is at ${current.revision}`,
      );
    }
    return this.store.withResourceLock("capabilities", async () => {
      await this.assertCapabilityDeltasUnchanged(current);
      const deltas = await loadCapabilityDeltas(this.store, current.activeFeature!);
      if (deltas.length === 0 && current.capabilityArchiveRequired) {
        throw new EmpiricalError("DELTA_REQUIRED", `Complex change ${current.activeFeature} has no capability deltas`);
      }
      const impact = await readJson<ImpactManifest>(
        join(this.store.specDirectory(current.activeFeature!), "impact.json"),
        "INVALID_IMPACT",
      );
      verifyImpactManifest(impact);
      if (current.impactDigest !== impact.digest) {
        throw new EmpiricalError("IMPACT_CHANGED", "The approved impact manifest changed before integration");
      }

      let claimId = current.capabilityClaimId;
      if (current.capabilityArchiveRequired && !claimId) {
        const bases = await captureCapabilityBases({
          root: this.store.root,
          feature: current.activeFeature!,
          deltas,
        });
        claimId = (
          await claimCapabilities({
            root: this.store.root,
            feature: current.activeFeature!,
            bases,
          })
        ).claim.id;
      }

      const validate = (
        validationRoot: string,
        candidates: ReadonlyArray<{ capability: string; next: string; resultDigest: string }>,
      ) => this.validateIntegrationTarget(validationRoot, candidates);
      const existingReceipt = await readOptionalJson<Record<string, unknown>>(receiptPath);
      let receipt: Record<string, unknown>;
      if (existingReceipt) {
        if (existingReceipt.feature !== current.activeFeature) {
          throw new EmpiricalError(
            "INTEGRATION_RECEIPT_CONFLICT",
            "The immutable integration receipt belongs to another feature",
          );
        }
        if (current.capabilityArchiveRequired) {
          const typedReceipt = existingReceipt as unknown as IntegrationReceipt;
          verifyIntegrationReceipt(typedReceipt);
          if (typedReceipt.claimId !== claimId) {
            throw new EmpiricalError(
              "INTEGRATION_RECEIPT_CONFLICT",
              "The immutable integration receipt belongs to another capability claim",
            );
          }
          const claims = await inspectCapabilityClaims(this.store.root);
          const integratedClaim = claims.integrated.find((claim) => claim.id === claimId);
          if (integratedClaim?.integrationReceiptDigest !== typedReceipt.digest) {
            throw new EmpiricalError(
              "INTEGRATION_RECEIPT_CONFLICT",
              "The integration receipt is not bound to a completed shared capability claim",
            );
          }
          for (const [capability, expectedDigest] of Object.entries(typedReceipt.resultDigests)) {
            const projection = await this.store.readCapability(capability);
            if (projection === null || capabilityMarkdownDigest(projection) !== expectedDigest) {
              throw new EmpiricalError(
                "INTEGRATION_RECEIPT_CONFLICT",
                `Living capability ${capability} does not match the integration receipt`,
              );
            }
          }
        } else {
          verifyDigestRecord(existingReceipt, "Non-behavioral integration receipt");
        }
        receipt = existingReceipt;
      } else if (current.capabilityArchiveRequired) {
        const integrated = await integrateCapabilities({
          root: this.store.root,
          targetRoot: resolve(targetRoot),
          feature: current.activeFeature!,
          claimId: claimId!,
          validator: validate,
        });
        verifyIntegrationReceipt(integrated);
        receipt = integrated as unknown as Record<string, unknown>;
      } else {
        receipt = await this.integrateNonBehavioral(
          current.activeFeature!,
          resolve(targetRoot),
          validate,
        );
      }

      const report = archiveReport(current.activeFeature!, deltas);
      const authorization = current.authorizationDigest
        ? await readExistingAuthorization(
            join(this.store.specDirectory(current.activeFeature!), "authorization.json"),
          )
        : null;
      if (authorization) {
        verifyAuthorization(authorization);
        if (authorization.digest !== current.authorizationDigest) {
          throw new EmpiricalError(
            "AUTHORIZATION_CHANGED",
            "The standing authorization no longer matches workflow state",
          );
        }
      }
      const deliveryAuthorized = authorization
        ? completionRank(authorization.ceiling) >= completionRank("delivered")
        : false;
      const integratedState = await this.store.transaction(async (latest) => {
        if (latest.revision !== expectedRevision) {
          throw new EmpiricalError(
            "STALE_REVISION",
            `Expected revision ${expectedRevision}, but the project is at ${latest.revision}`,
          );
        }
        if (latest.phase !== "integrate" || latest.status !== "waiting") {
          throw new EmpiricalError("INTEGRATION_NOT_READY", "Complex work must pass review before integration");
        }
        const state = structuredClone(latest);
        state.phase = deliveryAuthorized ? "deliver" : "done";
        state.status = deliveryAuthorized ? "waiting" : "done";
        state.capabilityClaimId = claimId;
        state.completion = deriveCompletion({
          ...state.completion,
          implemented: true,
          verified: true,
          integrated: true,
        });
        state.message = report.capabilities.length > 0
          ? `Integrated capability changes: ${report.capabilities.join(", ")}`
          : "Integrated non-behavioral change with independent validation";
        state.repairAttempts = 0;
        return {
          actor: actor.trim() || "agent",
          summary: state.message,
          state,
          value: latest.activeFeature!,
        };
      });
      if (integratedState.state.phase === "done" && integratedState.state.status === "done") {
        await this.store.compactTerminalJournal("empirical-integrate");
      }
      return {
        action: await this.packet(
          integratedState.state,
          parseCriteria(await this.store.readSpec(integratedState.value)),
        ),
        report,
        receipt,
      };
    });
  }

  async deliver(input: DeliveryInput): Promise<DeliveryResult> {
    const current = await this.store.loadState();
    if (
      current.activeFeature
      && current.phase === "done"
      && current.status === "done"
      && current.completion.delivered
      && current.revision === input.revision + 1
    ) {
      const receipt = await readJson<GitHubDeliveryReceipt>(
        join(this.store.specDirectory(current.activeFeature), "delivery-receipt.json"),
        "INVALID_DELIVERY_RECEIPT",
      );
      verifyDeliveryReceipt(receipt);
      return {
        action: await this.packet(
          current,
          parseCriteria(await this.store.readSpec(current.activeFeature)),
        ),
        receipt: receipt as unknown as Record<string, unknown>,
      };
    }
    if (!current.activeFeature || current.phase !== "deliver" || current.status !== "waiting") {
      throw new EmpiricalError(
        "DELIVERY_NOT_READY",
        "Delivery requires a verified integration and an active authorized Deliver phase",
      );
    }
    if (current.revision !== input.revision) {
      throw new EmpiricalError(
        "STALE_REVISION",
        `Expected revision ${input.revision}, but the project is at ${current.revision}`,
      );
    }
    if (!current.completion.integrated) {
      throw new EmpiricalError("INTEGRATION_REQUIRED", "Delivery cannot precede integration");
    }
    const policy = await this.store.loadPolicy();
    if (!policy.delivery) {
      throw new EmpiricalError("DELIVERY_POLICY_REQUIRED", "Policy v2 has no GitHub delivery target");
    }
    const authorization = await readExistingAuthorization(
      join(this.store.specDirectory(current.activeFeature), "authorization.json"),
    );
    if (!authorization) {
      throw new EmpiricalError("DELIVERY_AUTHORIZATION_REQUIRED", "Delivery requires standing authorization");
    }
    verifyAuthorization(authorization);
    if (
      authorization.digest !== current.authorizationDigest
      || completionRank(authorization.ceiling) < completionRank("delivered")
    ) {
      throw new EmpiricalError(
        "DELIVERY_AUTHORIZATION_REQUIRED",
        "Standing authorization does not cover GitHub delivery",
      );
    }
    const identity = await resolveGitRepositoryIdentity(this.store.root);
    if (authorization.repositoryId !== identity.repositoryId) {
      throw new EmpiricalError(
        "DELIVERY_AUTHORIZATION_MISMATCH",
        "Standing authorization belongs to another repository",
      );
    }
    const receiptFile = join(
      this.store.specDirectory(current.activeFeature),
      "delivery-receipt.json",
    );
    let receipt = await readOptionalJson<GitHubDeliveryReceipt>(receiptFile);
    if (receipt) {
      verifyDeliveryReceipt(receipt);
    } else {
      const bindingRelative = `.empirical/specs/${current.activeFeature}/delivery-source.json`;
      if (!input.evidence.paths.includes(bindingRelative)) {
        throw new EmpiricalError(
          "DELIVERY_EVIDENCE_PATH_REQUIRED",
          `Evidence commit paths must include ${bindingRelative}`,
        );
      }
      receipt = await deliverToGitHub({
        root: this.store.root,
        repositoryId: identity.repositoryId,
        feature: current.activeFeature,
        authorization,
        targetBranch: policy.delivery.targetBranch,
        requiredChecks: policy.delivery.requiredChecks,
        source: input.source,
        evidence: input.evidence,
        prepareEvidence: async (mergedSourceCommit) => {
          const body = {
            schemaVersion: 1,
            feature: current.activeFeature!,
            sourceMergeCommit: mergedSourceCommit,
            integrationReceiptDigest: String(
              (await readJson<Record<string, unknown>>(
                join(this.store.specDirectory(current.activeFeature!), "integration-receipt.json"),
                "INVALID_INTEGRATION_RECEIPT",
              )).digest ?? "",
            ),
          };
          const value = { ...body, digest: digestJson(body) };
          const existing = await readOptionalJson<Record<string, unknown>>(
            join(this.store.root, bindingRelative),
          );
          if (existing) {
            if (digestJson(existing) !== digestJson(value)) {
              throw new EmpiricalError(
                "DELIVERY_EVIDENCE_CONFLICT",
                "Existing source-merge evidence conflicts with the remote merge commit",
              );
            }
          } else {
            await writeJsonExclusive(join(this.store.root, bindingRelative), value);
          }
        },
      });
      verifyDeliveryReceipt(receipt);
      await writeJsonExclusive(receiptFile, receipt);
    }
    const transitioned = await this.store.transition(
      current.revision,
      input.actor?.trim() || "agent",
      `Delivered source PR #${receipt.source.number} and evidence PR #${receipt.evidence.number}`,
      (state) => ({
        ...state,
        phase: "done",
        status: "done",
        message: `Delivered through ${receipt!.evidence.mergeCommit}`,
        completion: deriveCompletion({
          ...state.completion,
          implemented: true,
          verified: true,
          integrated: true,
          delivered: true,
        }),
      }),
    );
    await this.store.compactTerminalJournal("empirical-deliver");
    return {
      action: await this.packet(
        transitioned,
        parseCriteria(await this.store.readSpec(transitioned.activeFeature!)),
      ),
      receipt: receipt as unknown as Record<string, unknown>,
    };
  }

  async publish(input: PublicationInput): Promise<PublicationResult> {
    if (input.approved !== true) {
      throw new EmpiricalError(
        "PUBLICATION_AUTHORIZATION_REQUIRED",
        "Publication requires literal approval and an exact immutable version",
      );
    }
    const current = await this.store.loadState();
    if (!current.activeFeature) {
      throw new EmpiricalError("NO_ACTIVE_PHASE", "Publication requires an explicitly selected delivered feature");
    }
    const receiptFile = join(
      this.store.specDirectory(current.activeFeature),
      "publication-receipt.json",
    );
    if (
      current.phase === "done"
      && current.status === "done"
      && current.completion.published
      && current.revision === input.revision + 1
    ) {
      const receipt = await readJson<PublicationReceipt>(receiptFile, "INVALID_PUBLICATION_RECEIPT");
      verifyPublicationReceipt(receipt);
      return {
        action: await this.packet(current, parseCriteria(await this.store.readSpec(current.activeFeature))),
        receipt: receipt as unknown as Record<string, unknown>,
      };
    }
    if (
      current.phase !== "done"
      || current.status !== "done"
      || !current.completion.delivered
      || current.completion.published
    ) {
      throw new EmpiricalError(
        "PUBLICATION_NOT_READY",
        "Publication requires a durably delivered, not-yet-published feature",
      );
    }
    if (current.revision !== input.revision) {
      throw new EmpiricalError(
        "STALE_REVISION",
        `Expected revision ${input.revision}, but the project is at ${current.revision}`,
      );
    }
    verifyAuthorization(input.authorization);
    const identity = await resolveGitRepositoryIdentity(this.store.root);
    const expectedRequestDigest = publicationRequestDigest({
      repositoryId: identity.repositoryId,
      feature: current.activeFeature,
      packageName: input.packageName,
      version: input.version,
      distTag: input.distTag,
      commit: input.commit,
    });
    if (
      input.authorization.repositoryId !== identity.repositoryId
      || input.authorization.feature !== current.activeFeature
      || input.authorization.ceiling !== "published"
      || input.authorization.requestDigest !== expectedRequestDigest
    ) {
      throw new EmpiricalError(
        "PUBLICATION_AUTHORIZATION_REQUIRED",
        "Publication authorization is not bound to this repository, feature, version, tag, and commit",
      );
    }
    const deliveryReceipt = await readJson<GitHubDeliveryReceipt>(
      join(this.store.specDirectory(current.activeFeature), "delivery-receipt.json"),
      "INVALID_DELIVERY_RECEIPT",
    );
    verifyDeliveryReceipt(deliveryReceipt);
    if (deliveryReceipt.evidence.mergeCommit !== input.commit) {
      throw new EmpiricalError(
        "PUBLICATION_COMMIT_MISMATCH",
        "Publication commit must be the independently confirmed evidence merge commit",
      );
    }
    const authorizationFile = join(
      this.store.specDirectory(current.activeFeature),
      "publication-authorization.json",
    );
    const existingAuthorization = await readOptionalJson<StandingAuthorization>(authorizationFile);
    if (existingAuthorization) {
      verifyAuthorization(existingAuthorization);
      if (existingAuthorization.digest !== input.authorization.digest) {
        throw new EmpiricalError(
          "PUBLICATION_AUTHORIZATION_CONFLICT",
          "A different immutable publication authorization already exists",
        );
      }
    } else {
      await writeJsonExclusive(authorizationFile, input.authorization);
    }

    let receipt = await readOptionalJson<PublicationReceipt>(receiptFile);
    if (receipt) {
      verifyPublicationReceipt(receipt);
      if (
        receipt.authorizationDigest !== input.authorization.digest
        || receipt.repositoryId !== identity.repositoryId
        || receipt.feature !== current.activeFeature
        || receipt.version !== input.version
        || receipt.distTag !== input.distTag
        || receipt.commit !== input.commit
      ) {
        throw new EmpiricalError(
          "PUBLICATION_RECEIPT_CONFLICT",
          "Existing immutable publication receipt conflicts with this request",
        );
      }
    } else {
      receipt = await publishImmutable({
        root: this.store.root,
        authorization: input.authorization,
        repositoryId: identity.repositoryId,
        feature: current.activeFeature,
        packageName: input.packageName,
        version: input.version,
        distTag: input.distTag,
        commit: input.commit,
      });
      await writeJsonExclusive(receiptFile, receipt);
    }
    const transitioned = await this.store.transition(
      current.revision,
      input.actor?.trim() || "agent",
      `Published immutable version ${input.version}`,
      (state) => ({
        ...state,
        phase: "done",
        status: "done",
        message: `Published ${input.packageName}@${input.version} from ${input.commit}`,
        completion: deriveCompletion({
          ...state.completion,
          implemented: true,
          verified: true,
          integrated: true,
          delivered: true,
          published: true,
        }),
      }),
    );
    await this.store.compactTerminalJournal("empirical-publish");
    return {
      action: await this.packet(
        transitioned,
        parseCriteria(await this.store.readSpec(transitioned.activeFeature!)),
      ),
      receipt: receipt as unknown as Record<string, unknown>,
    };
  }

  async archive(_expectedRevision: number, _actor = "agent"): Promise<ArchiveResult> {
    throw new EmpiricalError(
      "INTEGRATION_REQUIRED",
      "Schema 5 replaces direct archive with empirical_integrate against an independent target worktree",
    );
  }

  async retry(expectedRevision: number, actor = "human"): Promise<ActionPacket> {
    const current = await this.store.loadState();
    if (!(["blocked", "awaiting_human"] as const).includes(
      current.status as "blocked" | "awaiting_human",
    )) {
      throw new EmpiricalError("NOT_PAUSED", "The workflow is not blocked or awaiting human input");
    }
    const ceilingReached = current.mode === "yolo"
      && current.message?.startsWith("YOLO authorization ceiling ") === true;
    const state = await this.store.transition(expectedRevision, actor, "Resumed workflow", (state) => ({
      ...state,
      ...(ceilingReached ? { mode: "normal" as const, authorizationDigest: null } : {}),
      status: "waiting",
      message: null,
    }));
    const criteria = state.activeFeature
      ? parseCriteria(await this.store.readSpec(state.activeFeature))
      : [];
    return this.packet(state, criteria);
  }

  async verify(): Promise<ValidationReport> {
    const state = await this.store.loadState(!this.readOnly);
    if (!state.activeFeature) {
      return { valid: false, phase: state.phase, criteria: 0, missing: ["No active feature"] };
    }
    const spec = await this.store.readSpec(state.activeFeature);
    const criteria = parseCriteria(spec);
    const config = await this.store.loadConfig();
    let receipts: EvidenceReceipt[] = [];
    const missing: string[] = [];
    try {
      receipts = await this.receiptRecords(state, criteria, state.evidenceReceiptIds);
    } catch (error) {
      missing.push(error instanceof Error ? error.message : String(error));
    }
    missing.push(...validateReceiptEvidence(
      criteria,
      receipts,
      config,
      state.phase === "review" || state.phase === "integrate" || state.phase === "archive" || state.phase === "done",
    ));
    if (state.specDigest && state.specDigest !== digest(spec)) {
      missing.push("Specification changed after the last completed revision");
    }
    if (state.capabilityArchiveRequired && state.capabilityDeltaDigest) {
      try {
        if (await capabilityDeltaDigest(this.store, state.activeFeature) !== state.capabilityDeltaDigest) {
          missing.push("Capability deltas changed after Specify approval");
        }
      } catch {
        missing.push("Capability deltas are malformed or unreadable after Specify approval");
      }
    }
    return { valid: missing.length === 0, phase: state.phase, criteria: criteria.length, missing };
  }

  async integrations(): Promise<IntegrationReport> {
    return installProjectIntegrations(this.store.root);
  }

  async migrate(): Promise<Record<string, unknown>> {
    const migration = await new ProjectStore(this.store.root).migrateSchema();
    return {
      ...migration,
      version: PRODUCT_VERSION,
      schemaVersion: SCHEMA_VERSION,
    };
  }

  async doctor(): Promise<Record<string, unknown>> {
    return { ...(await doctorRepository(this.store.root)) };
  }

  private async validateIntegrationTarget(
    targetRoot: string,
    candidates: ReadonlyArray<{ capability: string; next: string; resultDigest: string }>,
  ): Promise<{ featureTree: string; verificationReceiptDigests: string[] }> {
    const policy = await this.store.loadPolicy();
    if (policy.verification.commands.length === 0) {
      throw new EmpiricalError(
        "INTEGRATION_POLICY_REQUIRED",
        "Independent integration requires at least one Policy v2 verification command",
      );
    }
    const restoreSourceOverlay = await applySourceOverlay(this.store.root, targetRoot);
    const targetStore = new ProjectStore(targetRoot);
    const originals: Array<{ capability: string; contents: string | null }> = [];
    try {
      for (const candidate of candidates) {
        originals.push({
          capability: candidate.capability,
          contents: await targetStore.readCapability(candidate.capability),
        });
        await targetStore.writeCapability(candidate.capability, candidate.next);
      }
      const featureTreeBefore = await repositoryTreeDigest(targetRoot);
      const verificationReceiptDigests: string[] = [];
      for (const command of policy.verification.commands) {
        const result = await executeCommand(targetRoot, {
          argv: [...command.argv],
          cwd: command.cwd,
          timeoutMs: command.timeoutMs,
          maxOutputBytes: command.maxOutputBytes,
        });
        if (result.exitCode !== 0 || result.signal !== null || result.timedOut) {
          throw new EmpiricalError(
            "INTEGRATION_VERIFICATION_FAILED",
            `Independent command ${command.id} failed with ${result.timedOut ? "timeout" : result.signal ?? result.exitCode}`,
          );
        }
        verificationReceiptDigests.push(
          digestJson({
            commandId: command.id,
            candidateDigests: candidates.map((candidate) => candidate.resultDigest),
            result,
          }),
        );
      }
      const featureTree = await repositoryTreeDigest(targetRoot);
      if (featureTree !== featureTreeBefore) {
        throw new EmpiricalError(
          "INTEGRATION_TARGET_MUTATED",
          "Independent verification commands changed the target worktree",
        );
      }
      return { featureTree, verificationReceiptDigests };
    } finally {
      for (const original of originals.reverse()) {
        if (original.contents === null) {
          await targetStore.removeCapability(original.capability);
        } else {
          await targetStore.writeCapability(original.capability, original.contents);
        }
      }
      await restoreSourceOverlay();
    }
  }

  private async integrateNonBehavioral(
    feature: string,
    targetRoot: string,
    validate: (
      root: string,
      candidates: ReadonlyArray<{ capability: string; next: string; resultDigest: string }>,
    ) => Promise<{ featureTree: string; verificationReceiptDigests: string[] }>,
  ): Promise<Record<string, unknown>> {
    const [source, target] = await Promise.all([
      resolveGitRepositoryIdentity(this.store.root),
      resolveGitRepositoryIdentity(targetRoot),
    ]);
    if (source.repositoryId !== target.repositoryId) {
      throw new EmpiricalError(
        "INTEGRATION_TARGET_MISMATCH",
        "Integration target belongs to a different Git repository",
      );
    }
    if (source.worktreeId === target.worktreeId) {
      throw new EmpiricalError(
        "INTEGRATION_TARGET_REQUIRED",
        "Integration validation requires an independent target worktree",
      );
    }
    const validation = await validate(targetRoot, []);
    const body = {
      schemaVersion: 1,
      classification: "non-behavioral",
      feature,
      claimId: null,
      repositoryId: source.repositoryId,
      featureTree: validation.featureTree,
      targetCommit: target.headCommit,
      targetTree: target.headTree,
      verificationReceiptDigests: validation.verificationReceiptDigests,
      integratedAt: new Date().toISOString(),
    };
    const receipt = { ...body, digest: digestJson(body) };
    await writeJsonExclusive(
      join(this.store.specDirectory(feature), "integration-receipt.json"),
      receipt,
    );
    return receipt;
  }

  private assertEvidencePhase(state: WorkflowState): void {
    if (
      !state.activeFeature ||
      !(
        state.phase === "verify" ||
        state.phase === "review" ||
        (state.profile === "fast" && state.phase === "implement") ||
        state.phase === "integrate"
      )
    ) {
      throw new EmpiricalError(
        "EVIDENCE_NOT_READY",
        "Evidence can be recorded only for the current Fast, Verify, Review, or Integrate action",
      );
    }
  }

  private async validateEvidenceCriteria(
    state: WorkflowState,
    requested: string[],
  ): Promise<string[]> {
    if (!state.activeFeature) throw new EmpiricalError("NO_ACTIVE_PHASE", "No feature is active");
    const normalized = [...new Set(requested.map((id) => id.trim()).filter(Boolean))].sort();
    if (normalized.length === 0) {
      throw new EmpiricalError("INVALID_EVIDENCE", "Evidence must name at least one criterion");
    }
    const known = new Set(
      parseCriteria(await this.store.readSpec(state.activeFeature)).map((criterion) => criterion.id),
    );
    const unknown = normalized.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new EmpiricalError(
        "INVALID_EVIDENCE",
        `Evidence references unknown criteria: ${unknown.join(", ")}`,
      );
    }
    return normalized;
  }

  private async evidenceProvenance(state: WorkflowState) {
    if (!state.activeFeature || !state.approvedSpecRevision) {
      throw new EmpiricalError(
        "SPEC_NOT_APPROVED",
        "Evidence requires a specification with a durable approved revision",
      );
    }
    const spec = await this.store.readSpec(state.activeFeature);
    const specDigest = digest(spec);
    if (state.specDigest !== specDigest) {
      throw new EmpiricalError(
        "SPEC_CHANGED",
        "The specification changed after approval; evidence would be stale",
      );
    }
    const policy = await this.store.loadPolicy();
    const repositoryId = await resolveGitRepositoryIdentity(this.store.root)
      .then((identity) => identity.repositoryId)
      .catch(() => sha256(resolve(this.store.root)));
    return {
      repositoryId,
      feature: state.activeFeature,
      specRevision: state.approvedSpecRevision,
      specDigest,
      treeDigest: await repositoryTreeDigest(this.store.root),
      policyDigest: digestJson(policy),
    };
  }

  private async receiptRecords(
    state: WorkflowState,
    criteria: Criterion[],
    receiptIds: string[],
  ): Promise<EvidenceReceipt[]> {
    if (!state.activeFeature || !state.approvedSpecRevision || !state.specDigest) return [];
    const policy = await this.store.loadPolicy();
    const repositoryId = await resolveGitRepositoryIdentity(this.store.root)
      .then((identity) => identity.repositoryId)
      .catch(() => sha256(resolve(this.store.root)));
    const context = {
      root: this.store.root,
      repositoryId,
      feature: state.activeFeature,
      criteria,
      specRevision: state.approvedSpecRevision,
      specDigest: state.specDigest,
      treeDigest: await repositoryTreeDigest(this.store.root),
      policyDigest: digestJson(policy),
    };
    const records: EvidenceReceipt[] = [];
    for (const id of [...new Set(receiptIds)]) {
      if (!/^(?:executed|collected)-[a-z0-9-]+$/.test(id)) {
        throw new EmpiricalError("INVALID_EVIDENCE", `Invalid evidence receipt id: ${id}`);
      }
      records.push(
        await readAndValidateReceipt(
          join(this.store.specDirectory(state.activeFeature), "evidence", "receipts", `${id}.json`),
          context,
        ),
      );
    }
    return records;
  }

  private async validatePhasePass(
    state: WorkflowState,
    input: CompletionInput,
    criteria: Criterion[],
    config: ProjectConfig,
    receiptIds: string[],
  ): Promise<PhaseApproval> {
    const approval: PhaseApproval = {
      deltaDigest: null,
      impactDigest: null,
      capabilityClaimId: null,
      behavioral: null,
    };
    if ((state.phase === "shape" || state.phase === "specify") && criteria.length === 0) {
      throw new EmpiricalError(
        "CRITERIA_REQUIRED",
        `Add at least one '- [ ] [AC-1] observable behavior' to ${relativeSpec(state.activeFeature)}`,
      );
    }
    if (state.phase === "shape" || state.phase === "specify") {
      try {
        const { validateCriteria } = await import("./protocol.js");
        validateCriteria(criteria);
      } catch (error) {
        throw new EmpiricalError(
          "CRITERIA_REQUIRED",
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    if (state.phase === "specify" && state.profile === "complex") {
      const feature = state.activeFeature!;
      const impactPath = join(this.store.specDirectory(feature), "impact.json");
      const raw = await readJson<Record<string, unknown>>(impactPath, "INVALID_IMPACT");
      const classification = raw.classification === "non-behavioral"
        ? "non-behavioral"
        : "behavioral";
      const surfaces = Array.isArray(raw.surfaces)
        ? raw.surfaces.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        : [];
      const deltas = await loadCapabilityDeltas(this.store, feature);
      if (classification === "behavioral") {
        const report = await validateFeatureDeltas(this.store, feature);
        if (!report.valid) {
          throw new EmpiricalError(
            "DELTA_REQUIRED",
            `Capability deltas are incomplete: ${report.issues.join("; ")}`,
          );
        }
        const manifest = createImpactManifest({
          schemaVersion: 1,
          classification: "behavioral",
          capabilities: report.capabilities,
          surfaces: surfaces.length > 0 ? surfaces : ["workflow"],
          regressionRationale: null,
        });
        await writeJsonAtomic(impactPath, manifest);
        const bases = await captureCapabilityBases({
          root: this.store.root,
          feature,
          deltas,
        });
        const claimed = await claimCapabilities({
          root: this.store.root,
          feature,
          bases,
        }).catch((error) => {
          throw new EmpiricalError(
            "CAPABILITY_CLAIM_REQUIRED",
            `Behavioral Complex work requires Git common-directory claims: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
        approval.deltaDigest = report.digest;
        approval.impactDigest = manifest.digest;
        approval.capabilityClaimId = claimed.claim.id;
        approval.behavioral = true;
      } else {
        if (deltas.length > 0) {
          throw new EmpiricalError(
            "INVALID_IMPACT",
            "Non-behavioral Complex work must not contain capability deltas",
          );
        }
        const manifest = createImpactManifest({
          schemaVersion: 1,
          classification: "non-behavioral",
          capabilities: [],
          surfaces: surfaces.length > 0 ? surfaces : ["internal-implementation"],
          regressionRationale:
            typeof raw.regressionRationale === "string"
              ? raw.regressionRationale
              : "No observable capability changes; regression receipts preserve current behavior.",
        });
        await writeJsonAtomic(impactPath, manifest);
        approval.impactDigest = manifest.digest;
        approval.behavioral = false;
      }
    }
    if (state.phase === "design") {
      await requireArtifact(this.store.specDirectory(state.activeFeature!), "design.md");
      if (config.decisions.complexRecords === "required" && state.profile === "complex") {
        await requireValidDecisions(this.store, state.activeFeature!);
      }
    }
    if (state.phase === "plan") {
      await requireArtifact(this.store.specDirectory(state.activeFeature!), "plan.md");
    }
    if (state.phase === "context") {
      const knowledge = await inspectRepositoryKnowledge(this.store.root);
      if (!knowledge.valid) {
        const reasons = [
          ...(knowledge.issues.length > 0 ? [`invalid manifest: ${knowledge.issues.join("; ")}`] : []),
          ...(knowledge.missing.length > 0 ? [`missing: ${knowledge.missing.join(", ")}`] : []),
          ...(knowledge.stale.length > 0 ? [`stale: ${knowledge.stale.join(", ")}`] : []),
          ...(knowledge.refinementRequired.length > 0
            ? [`refinement required: ${knowledge.refinementRequired.join(", ")}`]
            : []),
        ];
        throw new EmpiricalError(
          "CONTEXT_REFINEMENT_REQUIRED",
          `Repository knowledge is not ready: ${reasons.join("; ")}. Refresh inventory, inspect repository evidence, replace placeholder topic content, remove the managed marker from refined pages, refresh again, and retry this Context revision.`,
        );
      }
    }
    if (state.phase === "verify") {
      const receipts = await this.receiptRecords(state, criteria, receiptIds);
      const missing = validateReceiptEvidence(criteria, receipts, config, false);
      if (missing.length > 0) {
        throw new EmpiricalError("EVIDENCE_REQUIRED", `Verification is incomplete: ${missing.join("; ")}`);
      }
    }
    if (state.phase === "review") {
      if (config.decisions.complexRecords === "required" && state.profile === "complex") {
        await requireValidDecisions(this.store, state.activeFeature!);
      }
      if (config.evidence.codeReview) {
        const receipts = await this.receiptRecords(state, criteria, receiptIds);
        const missing = validateReceiptEvidence(criteria, receipts, config, true)
          .filter((item) => item.includes("review"));
        if (missing.length > 0) {
          throw new EmpiricalError("REVIEW_REQUIRED", "Review completion needs passing review evidence");
        }
      }
    }
    if (state.profile === "fast" && state.phase === "implement") {
      if (criteria.length === 0) {
        throw new EmpiricalError(
          "CRITERIA_REQUIRED",
          `Add at least one '- [ ] [AC-1] observable behavior' to ${relativeSpec(state.activeFeature)}`,
        );
      }
      const receipts = await this.receiptRecords(state, criteria, receiptIds);
      const missing = validateReceiptEvidence(criteria, receipts, config, true);
      if (missing.length > 0) {
        throw new EmpiricalError(
          "EVIDENCE_REQUIRED",
          `Fast completion is incomplete: ${missing.join("; ")}`,
        );
      }
    }
    return approval;
  }

  private async assertCapabilityDeltasUnchanged(state: WorkflowState): Promise<void> {
    if (!state.activeFeature) return;
    if (state.impactDigest) {
      try {
        const impact = await readJson<ImpactManifest>(
          join(this.store.specDirectory(state.activeFeature), "impact.json"),
          "INVALID_IMPACT",
        );
        verifyImpactManifest(impact);
        if (impact.digest !== state.impactDigest) throw new Error("digest changed");
      } catch {
        throw new EmpiricalError(
          "IMPACT_CHANGED",
          "The impact manifest changed after Specify approval; restore the approved manifest",
        );
      }
    }
    if (!state.capabilityArchiveRequired || !state.capabilityDeltaDigest) return;
    try {
      if (await capabilityDeltaDigest(this.store, state.activeFeature) === state.capabilityDeltaDigest) return;
    } catch {
      // Report one stable workflow error for malformed, missing, or unreadable approved deltas.
    }
    throw new EmpiricalError(
      "DELTA_CHANGED",
      "Capability deltas changed after Specify approval; restore the approved deltas before continuing",
    );
  }

  private async packet(state: WorkflowState, criteria: Criterion[]): Promise<ActionPacket> {
    const policy = await this.store.loadPolicy();
    const config = await this.store.loadConfig();
    const capabilities = await listCapabilities(this.store);
    const artifacts = expectedArtifacts(state, config.decisions.complexRecords === "required");
    const missingArtifacts: string[] = [];
    for (const artifact of artifacts) {
      if (artifact.includes("deltas/<capability>.md") && state.activeFeature) {
        if (!(await validateFeatureDeltas(this.store, state.activeFeature)).valid) missingArtifacts.push(artifact);
      } else if (artifact.endsWith("/decisions.md") && state.activeFeature) {
        if (!(await validateDecisions(this.store, state.activeFeature, state.phase === "design" || state.phase === "review")).valid) {
          missingArtifacts.push(artifact);
        }
      } else if (artifact.includes("<capability>")) {
        missingArtifacts.push(artifact);
      } else if (!(await isFile(join(this.store.root, artifact)))) {
        missingArtifacts.push(artifact);
      }
    }
    if (state.phase === "context") {
      const knowledge = await inspectRepositoryKnowledge(this.store.root);
      missingArtifacts.push(
        ...knowledge.missing,
        ...knowledge.stale,
        ...knowledge.refinementRequired,
        ...knowledge.issues.map(() => ".empirical/context/manifest.json"),
      );
    }
    return actionPacket(
      this.store.root,
      state,
      criteria,
      policy,
      await existingKnowledgePaths(this.store.root),
      capabilities.map((capability) => capability.path),
      artifacts,
      [...new Set(missingArtifacts)],
      config,
      await trackerStatus(this.store.root, state),
    );
  }
}

export function parseCriteria(markdown: string): Criterion[] {
  const criteria: Criterion[] = [];
  let inComment = false;
  let activeCriterion: Criterion | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    if (line.includes("<!--")) {
      inComment = true;
      activeCriterion = null;
    }
    if (inComment) {
      if (line.includes("-->")) inComment = false;
      continue;
    }
    const match = /^\s*-\s*\[([ xX])\]\s*\[([^\]]+)\]\s*(.+?)\s*$/.exec(line);
    if (match?.[2] && match[3]) {
      const id = match[2].trim();
      const text = match[3].trim();
      activeCriterion = {
        id,
        text,
        ui: /\[UI\]/i.test(text),
        checked: match[1]?.toLowerCase() === "x",
      };
      criteria.push(activeCriterion);
      continue;
    }
    if (activeCriterion && /^\s{2,}\S/.test(line)) {
      activeCriterion.text = `${activeCriterion.text} ${line.trim()}`;
      activeCriterion.ui = /\[UI\]/i.test(activeCriterion.text);
      continue;
    }
    activeCriterion = null;
  }
  return criteria;
}

function defaultConfig(
  profile: Profile,
  legacySource: "ai" | null,
  options: ProjectConfigurationInput = {},
): ProjectConfig {
  return {
    schemaVersion: SCHEMA_VERSION,
    profile,
    maxRepairAttempts: 2,
    evidence: {
      required: options.evidence?.required ?? true,
      browserForUi: options.evidence?.browserForUi ?? true,
      screenshotForUi: options.evidence?.screenshotForUi ?? true,
      codeReview: options.evidence?.codeReview ?? true,
    },
    isolation: {
      mode: options.isolation?.mode ?? "ask",
      baseBranch: options.isolation?.baseBranch ?? "auto",
      worktreePath: options.isolation?.worktreePath ?? "../{repo}-{feature}",
      branchPattern: options.isolation?.branchPattern ?? "{type}/{feature}",
    },
    decisions: {
      complexRecords: options.decisions?.complexRecords ?? "required",
    },
    setupComplete: options.setupComplete ?? true,
    legacySource,
  };
}

function initializationConfiguration(options: InitOptions): ProjectConfigurationInput | null {
  const evidence = options.evidence && Object.keys(options.evidence).length > 0
    ? options.evidence
    : undefined;
  const isolation = options.isolation && Object.keys(options.isolation).length > 0
    ? options.isolation
    : undefined;
  const decisions = options.decisions && Object.keys(options.decisions).length > 0
    ? options.decisions
    : undefined;
  if (!evidence && !isolation && !decisions && options.setupComplete === undefined) return null;
  return {
    ...(evidence ? { evidence } : {}),
    ...(isolation ? { isolation } : {}),
    ...(decisions ? { decisions } : {}),
    ...(options.setupComplete !== undefined ? { setupComplete: options.setupComplete } : {}),
  };
}

async function applyTrackerSetup(project: EmpiricalProject, options: InitOptions): Promise<void> {
  const change = options.tracker ? parseTrackerSetupChange(options.tracker) : undefined;
  if (!change || change.mode === "preserve") return;
  if (change.mode === "disabled") {
    await project.configureTracker(null, options.trackerDependencies);
    return;
  }
  await project.configureTracker(change.policy, options.trackerDependencies);
}

function touchDiscoveryRecord(
  record: DiscoveryRecord,
  update: Partial<Omit<DiscoveryRecord, "schemaVersion" | "id" | "problem" | "createdAt">>,
): DiscoveryRecord {
  return { ...record, ...update, updatedAt: new Date().toISOString() };
}

function sameDiscoveryAnswers(left: DiscoveryRecord["answers"], right: DiscoveryRecord["answers"]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function extendsDiscoveryAnswers(
  saved: DiscoveryRecord["answers"],
  submitted: DiscoveryRecord["answers"],
): boolean {
  if (submitted.length < saved.length) return false;
  return saved.every((entry, index) => {
    const next = submitted[index];
    if (!next) return false;
    if (
      entry.pass !== next.pass
      || entry.title !== next.title
      || entry.question !== next.question
      || entry.answer !== next.answer
    ) return false;
    return entry.followUp === null || JSON.stringify(entry.followUp) === JSON.stringify(next.followUp);
  });
}

function initialState(profile: Profile): WorkflowState {
  const workflow: Workflow = profile === "complex" ? "complex" : "fast";
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    activeFeature: null,
    request: null,
    profile,
    workflow,
    mode: "normal",
    phase: "idle",
    status: "idle",
    repairAttempts: 0,
    message: null,
    implementationActor: null,
    specDigest: null,
    approvedSpecRevision: null,
    capabilityArchiveRequired: false,
    capabilityDeltaDigest: null,
    impactDigest: null,
    capabilityClaimId: null,
    authorizationDigest: null,
    evidence: [],
    evidenceReceiptIds: [],
    legacyEvidenceCount: 0,
    completion: deriveCompletion({
      implemented: false,
      verified: false,
      integrated: false,
      delivered: false,
      published: false,
    }),
    updatedAt: new Date().toISOString(),
  };
}

function renderSpec(title: string, request: string): string {
  return `# ${title}

## Request

${renderRequest(request)}

## Goal

Describe the observable result.

## Acceptance Criteria

<!-- Replace this comment with observable criteria such as:
- [ ] [AC-1] The user can complete the intended action.
- [ ] [AC-UI-1] [UI] The result is visible in the browser.
-->

## Scope

## Non-goals

## Verification

## Capability Deltas

Create one or more files under deltas/<capability>.md using ADDED, MODIFIED, or
REMOVED Requirements sections, named Requirement blocks, and concrete Scenario
examples. These merge into living specifications
after verification and review.
`;
}

function renderFastSpec(title: string, request: string): string {
  const criterion = request
    .replace(/<!--/g, "&lt;!--")
    .replace(/-->/g, "--&gt;")
    .replace(/\s+/g, " ")
    .trim();
  return `# ${title}

## Request

${renderRequest(request)}

## Goal

${criterion}

## Acceptance Criteria

- [ ] [AC-1] ${criterion}

## Scope

Small, localized, and reversible changes required by the request.

## Non-goals

Unrequested behavior or broader architectural changes.

## Verification

Run the smallest real check that proves AC-1 and inspect the resulting diff.
`;
}

function renderRequest(request: string): string {
  return request
    .replace(/<!--/g, "&lt;!--")
    .replace(/-->/g, "--&gt;")
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}

function actionPacket(
  root: string,
  state: WorkflowState,
  criteria: Criterion[],
  policy: ProjectPolicy,
  knowledgeContext: string[],
  capabilityContext: string[],
  artifacts: string[],
  missingArtifacts: string[],
  config: ProjectConfig,
  tracker: TrackerStatus,
): ActionPacket {
  const route = state.request
    ? routeRequest({
        request: state.request,
        mode: state.mode,
        requestedProfile: state.workflow,
        ...(state.workflow === "fast" ? { declaredContractNeutral: true } : {}),
      })
    : {
        profile: "fast" as const,
        mode: state.mode,
        riskFloor: "contract-neutral" as const,
        rationaleCodes: ["idle"],
        gates: ["host-permissions", "hard-safety-floor"],
        promoted: false,
      };
  const evidence = requiredEvidence(state, criteria, config);
  const completionAvailable = state.status === "waiting"
    && state.phase !== "idle"
    && state.phase !== "done";
  const specialOperation = state.phase === "archive" ? "integrate" : state.phase;
  const integration = specialOperation === "integrate";
  const delivery = specialOperation === "deliver";
  const publication = specialOperation === "publish";
  return {
    kind: "action",
    protocol: "empirical-sdd",
    schemaVersion: SCHEMA_VERSION,
    root,
    feature: state.activeFeature,
    request: state.request,
    profile: state.profile,
    mode: state.mode,
    riskFloor: route.riskFloor,
    routeRationale: route.rationaleCodes,
    phase: state.phase,
    status: state.status,
    revision: state.revision,
    instructions: instructionsFor(state, policy, config),
    rationale: rationaleFor(state, artifacts, missingArtifacts, evidence),
    acceptanceCriteria: criteria,
    requiredEvidence: evidence,
    artifacts,
    projectContext: policy.context,
    knowledgeContext,
    capabilityContext,
    completionLevel: state.completion,
    tracker,
    completion: {
      available: completionAvailable,
      mcpTool: integration
        ? "empirical_integrate"
        : delivery
          ? "empirical_deliver"
          : publication
            ? "empirical_publish"
            : "empirical_complete",
      cli: completionAvailable
        ? integration
          ? `empirical __internal integrate --revision ${state.revision} --target-root <independent-worktree>`
          : delivery
            ? `empirical __internal deliver --input <delivery.json>`
            : publication
              ? `empirical __internal publish --input <publication.json>`
          : `empirical __internal complete --revision ${state.revision} --outcome passed --summary "<what you did>"${evidence.length > 0 ? " --receipt <receipt-id>" : ""}`
        : "",
      requiredFields: completionAvailable
        ? integration
          ? ["revision", "targetRoot"]
          : delivery
            ? ["revision", "source", "evidence"]
            : publication
              ? ["revision", "version", "distTag"]
          : ["revision", "outcome", "summary", ...(evidence.length > 0 ? ["receiptIds"] : [])]
        : [],
    },
  };
}

function rationaleFor(
  state: WorkflowState,
  artifacts: string[],
  missingArtifacts: string[],
  evidence: EvidenceKind[],
): ActionRationale {
  const currentState = `${state.phase}/${state.status} at revision ${state.revision}`;
  const nextAction = state.status === "blocked" || state.status === "awaiting_human"
    ? "Resolve the stated gate, then retry the exact revision"
    : state.phase === "idle"
      ? "Start an approved Fast or Complex feature"
      : state.phase === "done"
        ? "Report completion"
        : state.phase === "integrate" || state.phase === "archive"
          ? "Integrate the reviewed capability deltas against an independent target"
          : `Complete ${state.phase} at revision ${state.revision}`;
  const reason = state.phase === "idle"
    ? "No non-terminal feature state exists in this checkout."
    : state.phase === "done"
      ? "All workflow gates have completed."
      : state.status === "blocked" || state.status === "awaiting_human"
        ? state.message ?? "The workflow state machine has an unresolved stop condition."
        : `The ${state.profile} state machine advances from ${state.phase} only after its artifacts and evidence pass.`;
  return {
    currentState,
    nextAction,
    reason,
    requiredContext: [...artifacts, ...evidence.map((kind) => `${kind} evidence`)],
    missingContext: [...missingArtifacts, ...evidence.map((kind) => `${kind} evidence`)],
    gate: state.status === "blocked" || state.status === "awaiting_human" ? "stop" : "proceed",
  };
}

function assertStartAction(
  action: ActionPacket,
  request: string,
  profile: "fast" | "complex",
  options: FeatureStartOptions,
): ActionPacket {
  if (action.request?.trim() !== request) {
    throw new EmpiricalError(
      "FEATURE_ACTIVE",
      action.feature
        ? `Feature ${action.feature} belongs to a different request`
        : "The requested feature is no longer active",
    );
  }
  if (profile !== action.profile) {
    throw new EmpiricalError(
      "PROFILE_CONFLICT",
      `The feature uses profile ${action.profile}, not ${profile}`,
    );
  }
  if (options.id && options.id !== action.feature) {
    throw new EmpiricalError(
      "FEATURE_ACTIVE",
      `The active feature is ${action.feature ?? "none"}, not ${options.id}`,
    );
  }
  return action;
}

function instructionsFor(state: WorkflowState, policy: ProjectPolicy, config: ProjectConfig): string {
  if (state.status === "blocked") return appendPolicy(`Stop. Resolve this blocker before retrying: ${state.message ?? "unknown"}`, state, policy);
  if (state.status === "awaiting_human") return appendPolicy(`Stop and ask the user: ${state.message ?? "a decision is required"}`, state, policy);
  if (state.phase === "idle") return appendPolicy("No feature is active. Loop does not create or route new work. Use the installed empirical skill for setup, automatic routing, concrete contracts, or five-pass discovery.", state, policy);
  if (state.phase === "done") return appendPolicy(`The feature reached ${state.completion.highest}. Report that exact completion level; delivery and publication require their own explicit authorization and receipts.`, state, policy);
  const feature = state.activeFeature ?? "current feature";
  const verifyInstruction = config.evidence.required
    ? `Run real tests for every criterion.${config.evidence.browserForUi ? " For [UI] criteria, use a real browser." : ""}${config.evidence.screenshotForUi ? " Capture a screenshot artifact for [UI] criteria." : ""} Return the configured structured evidence.`
    : "Criterion evidence is disabled. Run appropriate verification checks, but test/browser/screenshot records do not gate this transition; code-review policy remains independent.";
  const reviewInstruction = [
    "Review the implementation against every criterion and the diff.",
    ...(config.decisions.complexRecords === "required"
      ? [`Review accepted decisions in .empirical/specs/${feature}/decisions.md; contradictions require an explicit accepted superseding entry.`]
      : []),
    config.evidence.codeReview
      ? "Return passing review evidence or route failures back to implementation."
      : "Code-review evidence is disabled; still report material findings and route failures back to implementation.",
  ].join(" ");
  const instructions: Record<Exclude<Phase, "idle" | "done">, string> = {
    shape: `Read the request, edit ${relativeSpec(feature)}, and define concise observable acceptance criteria. Do not implement yet.`,
    specify: `Refine ${relativeSpec(feature)} into a complete contract with observable acceptance criteria, scope, non-goals, risks, and verification. Declare current-behavior changes in .empirical/specs/${feature}/deltas/<capability>.md using ADDED, MODIFIED, or REMOVED requirement blocks with scenarios.`,
    design: `Design the solution in .empirical/specs/${feature}/design.md and maintain .empirical/specs/${feature}/decisions.md with accepted evidence, options, the chosen approach, trade-offs/risks, and verification. Record concise reviewable decisions, never private chain-of-thought.`,
    plan: `Break the approved design into an executable plan in .empirical/specs/${feature}/plan.md.`,
    implement: state.profile === "fast"
      ? "Fast lane: the packet already contains the complete generated criterion. Inspect only the relevant project files, implement in one focused pass, combine the smallest real test and diff review when practical, then run the returned completion command. Do not reread Empirical state or add redundant checks. If the work is no longer small and low-risk, report failure so Empirical can escalate it."
      : "Implement the current acceptance criteria. Preserve unrelated work and run focused checks while editing.",
    context: "Refresh repository knowledge, inspect current repository evidence, replace every refinement-required TODO topic with concise evidence-backed content, remove the managed marker from refined pages, then refresh again to record the custom page digests. Complete this exact Context revision only when the context report has no stale, missing, invalid, or refinement-required paths.",
    verify: verifyInstruction,
    review: reviewInstruction,
    integrate: "Replay validated capability deltas against an independently resolved target, run Policy v2 verification there, and persist the integration receipt before advancing.",
    deliver: "Use the explicitly authorized GitHub source/evidence pull-request state machine. Never force push or bypass protected-branch policy.",
    publish: "Publish only the exact explicitly authorized immutable version; converge identical artifacts and stop on any conflict.",
    archive: "Legacy Schema-4 archive state must be migrated to Integrate before completion.",
  };
  return appendPolicy(instructions[state.phase], state, policy);
}

function appendPolicy(base: string, state: WorkflowState, policy: ProjectPolicy): string {
  const sections = [base];
  if (policy.context.length > 0) sections.push(`Project context:\n- ${policy.context.join("\n- ")}`);
  const phaseGuidance = policy.phases[state.phase] ?? [];
  if (phaseGuidance.length > 0) {
    sections.push(`Additional project guidance (mandatory Empirical gates still apply):\n- ${phaseGuidance.join("\n- ")}`);
  }
  return sections.join("\n\n");
}

function expectedArtifacts(state: WorkflowState, decisionsRequired: boolean): string[] {
  if (!state.activeFeature) return [];
  const base = `.empirical/specs/${state.activeFeature}`;
  if (state.phase === "shape") return [`${base}/spec.md`];
  if (state.phase === "specify") return [`${base}/spec.md`, `${base}/deltas/<capability>.md`];
  if (state.phase === "design") return [`${base}/design.md`, ...(decisionsRequired ? [`${base}/decisions.md`] : [])];
  if (state.phase === "plan") return [`${base}/plan.md`];
  if (state.phase === "context") return [
    ".empirical/context/index.md",
    ".empirical/context/overview.md",
    ".empirical/context/architecture.md",
    ".empirical/context/commands.md",
    ".empirical/context/conventions.md",
  ];
  if (state.phase === "review") return decisionsRequired ? [`${base}/decisions.md`] : [];
  if (state.phase === "integrate" || state.phase === "archive") {
    return [".empirical/capabilities/<capability>/spec.md", `${base}/integration-receipt.json`];
  }
  return [];
}

function requiredEvidence(
  state: WorkflowState,
  criteria: Criterion[],
  config: ProjectConfig,
): EvidenceKind[] {
  const fast = state.profile === "fast" && state.phase === "implement";
  if (state.phase !== "verify" && state.phase !== "review" && !fast) return [];
  const kinds = new Set<EvidenceKind>();
  if (config.evidence.required && (state.phase === "verify" || fast)) kinds.add("test");
  if (config.evidence.required && (state.phase === "verify" || fast) && criteria.some((criterion) => criterion.ui)) {
    if (config.evidence.browserForUi) kinds.add("browser");
    if (config.evidence.screenshotForUi) kinds.add("screenshot");
  }
  if (config.evidence.codeReview && (state.phase === "review" || fast)) kinds.add("review");
  return [...kinds];
}

function validateReceiptEvidence(
  criteria: Criterion[],
  receipts: EvidenceReceipt[],
  config: ProjectConfig,
  includeReview: boolean,
): string[] {
  const missing: string[] = [];
  if (config.evidence.required) {
    if (criteria.length === 0) missing.push("No acceptance criteria are defined");
    for (const criterion of criteria) {
      const records = receipts.filter(
        (record) => record.criteria.includes(criterion.id) && record.passed,
      );
      if (!records.some((record) => record.kind === "executed" && record.evidenceKinds.includes("test"))) {
        missing.push(`${criterion.id} has no passing test evidence`);
      }
      if (
        criterion.ui &&
        config.evidence.browserForUi &&
        !records.some((record) => record.evidenceKinds.includes("browser"))
      ) {
        missing.push(`${criterion.id} has no browser evidence`);
      }
      if (
        criterion.ui
        && config.evidence.screenshotForUi
        && !records.some(
          (record) =>
            record.kind === "collected" &&
            record.evidenceKinds.includes("screenshot") &&
            record.artifacts.length > 0,
        )
      ) {
        missing.push(`${criterion.id} has no screenshot artifact`);
      }
    }
  }
  if (includeReview && config.evidence.codeReview) {
    for (const criterion of criteria) {
      if (
        !receipts.some(
          (record) =>
            record.passed &&
            record.criteria.includes(criterion.id) &&
            record.evidenceKinds.includes("review"),
        )
      ) {
        missing.push(`${criterion.id} has no passing code review evidence`);
      }
    }
  }
  return missing;
}

function routeFailure(
  state: WorkflowState,
  summary: string,
  maxRepairAttempts: number,
): WorkflowState {
  state.message = summary;
  if (state.profile === "fast" && state.phase === "implement") {
    state.profile = "complex";
    state.workflow = "complex";
    state.phase = "specify";
    state.capabilityArchiveRequired = true;
    state.capabilityDeltaDigest = null;
    state.impactDigest = null;
    state.capabilityClaimId = null;
    state.approvedSpecRevision = null;
    state.repairAttempts = 0;
    state.evidence = [];
    state.evidenceReceiptIds = [];
    state.completion = deriveCompletion({
      implemented: false,
      verified: false,
      integrated: false,
      delivered: false,
      published: false,
    });
    state.status = "waiting";
    return state;
  }
  if (state.phase === "verify" || state.phase === "review") {
    state.repairAttempts += 1;
    state.evidence = [];
    state.evidenceReceiptIds = [];
    state.completion = deriveCompletion({
      implemented: true,
      verified: false,
      integrated: false,
      delivered: false,
      published: false,
    });
    if (state.repairAttempts > maxRepairAttempts) {
      state.status = "blocked";
      return state;
    }
    state.phase = "implement";
    state.status = "waiting";
    return state;
  }
  state.status = "waiting";
  return state;
}

function firstPhase(profile: Profile): Phase {
  if (profile === "fast") return "implement";
  return profile === "quick" ? "shape" : "specify";
}

function followingPhase(profile: Profile, phase: Phase): Phase {
  const sequence = profile === "fast"
    ? FAST_PHASES
    : profile === "quick"
      ? QUICK_PHASES
      : COMPLEX_PHASES;
  const index = sequence.indexOf(phase);
  if (index < 0) throw new EmpiricalError("INVALID_PHASE", `Phase ${phase} is not valid for ${profile}`);
  return sequence[index + 1] ?? "done";
}

function mapLegacyPhase(value: string | null, profile: Profile): Phase {
  const phase = value?.toLowerCase() ?? "";
  if (/done|complete|ready/.test(phase)) return "done";
  if (profile === "fast") return "implement";
  if (/review/.test(phase)) return "review";
  if (/context|knowledge/.test(phase)) return "context";
  if (/test|verify|qa/.test(phase)) return "verify";
  if (/develop|implement|dev/.test(phase)) return "implement";
  if (profile === "quick") return "shape";
  if (/plan/.test(phase)) return "plan";
  if (/architect|design/.test(phase)) return "design";
  return "specify";
}

function legacyField(contents: string, field: string): string | null {
  const match = new RegExp(`^\\s*${field}\\s*:\\s*([^#\\r\\n]+)`, "im").exec(contents);
  const value = match?.[1]?.trim();
  if (!value || /<none|none|null/i.test(value)) return null;
  return value.replace(/^['"]|['"]$/g, "");
}

function slugify(request: string): string {
  const slug = request
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .split("-")
    .slice(0, 7)
    .join("-");
  return slug || "feature";
}

function titleFromFeature(feature: string): string {
  const withoutNumber = feature.replace(/^\d+-/, "");
  return withoutNumber
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
    .join(" ") || basename(feature);
}

function relativeSpec(feature: string | null): string {
  return `.empirical/specs/${feature ?? "<feature>"}/spec.md`;
}

async function requireArtifact(directory: string, name: string): Promise<void> {
  const path = join(directory, name);
  if (!(await isFile(path)) || (await readFile(path, "utf8")).trim().length === 0) {
    throw new EmpiricalError("ARTIFACT_REQUIRED", `Create the non-empty artifact ${path}`);
  }
}

function digest(contents: string): string {
  return sha256(contents);
}

async function readExistingAuthorization(path: string): Promise<StandingAuthorization | null> {
  try {
    return await readJson<StandingAuthorization>(path, "INVALID_AUTHORIZATION");
  } catch (error) {
    if (error instanceof EmpiricalError && error.code === "INVALID_AUTHORIZATION") {
      const cause = error.details as NodeJS.ErrnoException | undefined;
      if (cause?.code === "ENOENT") return null;
    }
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeJsonExclusive(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(dirname(path));
}

async function readOptionalJson<T>(path: string): Promise<T | null> {
  try {
    return await readJson<T>(path, "INVALID_JSON");
  } catch (error) {
    if (
      error instanceof EmpiricalError
      && error.code === "INVALID_JSON"
      && (error.details as NodeJS.ErrnoException | undefined)?.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

interface SourceOverlayEntry {
  path: string;
  original: Buffer | null;
  originalMode: number | null;
}

const SOURCE_OVERLAY_EXCLUDED = new Set([
  ".empirical",
  ".git",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
]);

async function gitRead(
  root: string,
  args: string[],
  allowFailure = false,
): Promise<Awaited<ReturnType<typeof executeCommandCaptured>>> {
  const result = await executeCommandCaptured(root, {
    argv: ["git", ...args],
    cwd: ".",
    timeoutMs: 30_000,
    maxOutputBytes: 4_194_304,
  });
  if (
    !allowFailure
    && (result.result.exitCode !== 0 || result.result.signal !== null || result.result.timedOut)
  ) {
    throw new Error(`Git ${args.join(" ")} failed: ${result.stderr.trim() || result.result.exitCode}`);
  }
  return result;
}

function statusPaths(output: string): string[] {
  return output.split("\0").filter(Boolean).map((record) => {
    if (record.length < 4 || record[2] !== " ") {
      throw new Error("Git returned malformed porcelain status for integration overlay.");
    }
    return record.slice(3).replaceAll("\\", "/");
  });
}

function overlayIncluded(path: string): boolean {
  return !SOURCE_OVERLAY_EXCLUDED.has(path.split("/", 1)[0] ?? "")
    && !isMigrationScratchPath(path);
}

async function workingStatusPaths(root: string): Promise<string[]> {
  const result = await gitRead(root, [
    "-c",
    "status.renames=false",
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  return statusPaths(result.stdout);
}

async function revisionFile(root: string, path: string): Promise<string | null> {
  const result = await gitRead(root, ["ls-tree", "-z", "--full-tree", "HEAD", "--", path]);
  const records = result.stdout.split("\0").filter(Boolean);
  if (records.length === 0) return null;
  if (records.length !== 1) throw new Error(`Git returned multiple tree entries for ${path}.`);
  const separator = records[0]!.indexOf("\t");
  if (separator < 0) throw new Error(`Git returned malformed tree metadata for ${path}.`);
  const [mode, kind, objectId] = records[0]!.slice(0, separator).split(" ");
  const returnedPath = records[0]!.slice(separator + 1).replaceAll("\\", "/");
  if (
    returnedPath !== path
    || !/^(100644|100755|120000|160000)$/.test(mode ?? "")
    || !/^(blob|commit)$/.test(kind ?? "")
    || !/^[a-f0-9]{40,64}$/.test(objectId ?? "")
  ) {
    throw new Error(`Git returned invalid tree metadata for ${path}.`);
  }
  return `${mode}:${kind}:${objectId}`;
}

async function overlayFile(
  root: string,
  relativePath: string,
): Promise<{ bytes: Buffer; mode: number } | null> {
  const canonicalRoot = await realpath(resolve(root));
  const absolute = resolve(canonicalRoot, relativePath);
  const rel = relative(canonicalRoot, absolute);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Integration overlay path escapes the worktree: ${relativePath}`);
  }
  let cursor = canonicalRoot;
  for (const segment of relativePath.split("/").slice(0, -1)) {
    cursor = join(cursor, segment);
    const metadata = await lstat(cursor).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!metadata) break;
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error(`Integration overlay refuses symbolic or special directories: ${cursor}`);
    }
  }
  const metadata = await lstat(absolute).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!metadata) return null;
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`Integration overlay requires regular non-symbolic files: ${absolute}`);
  }
  return { bytes: await readFile(absolute), mode: metadata.mode & 0o777 };
}

async function writeOverlayFile(path: string, bytes: Buffer, mode: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.overlay`;
  const handle = await open(temporary, "wx", mode);
  try {
    await handle.writeFile(bytes);
    await chmod(temporary, mode);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, path);
    await syncDirectory(dirname(path));
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function syncDirectory(path: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, "r");
  } catch (error) {
    if (
      process.platform === "win32"
      && ["EISDIR", "EPERM", "EACCES"].includes(String((error as NodeJS.ErrnoException).code))
    ) return;
    throw error;
  }
  try {
    await handle.sync().catch((error: NodeJS.ErrnoException) => {
      if (
        process.platform === "win32"
        && ["EINVAL", "ENOTSUP", "EBADF", "EPERM"].includes(String(error.code))
      ) return;
      throw error;
    });
  } finally {
    await handle.close();
  }
}

function sameOverlayFile(
  left: { bytes: Buffer; mode: number } | null,
  right: { bytes: Buffer; mode: number } | null,
): boolean {
  if (left === null || right === null) return left === right;
  return left.mode === right.mode && left.bytes.equals(right.bytes);
}

async function applySourceOverlay(sourceRoot: string, targetRoot: string): Promise<() => Promise<void>> {
  const targetDirty = (await workingStatusPaths(targetRoot)).filter(overlayIncluded);
  if (targetDirty.length > 0) {
    throw new EmpiricalError(
      "INTEGRATION_TARGET_DIRTY",
      `Independent integration target has uncommitted source changes: ${targetDirty.join(", ")}`,
    );
  }
  const changed = [...new Set((await workingStatusPaths(sourceRoot)).filter(overlayIncluded))].sort();
  const target = await realpath(resolve(targetRoot));
  const applied: SourceOverlayEntry[] = [];
  const restore = async (): Promise<void> => {
    for (const entry of applied.reverse()) {
      const path = resolve(target, entry.path);
      if (entry.original === null || entry.originalMode === null) {
        await rm(path, { force: true });
      } else {
        await writeOverlayFile(path, entry.original, entry.originalMode);
      }
    }
    const remaining = (await workingStatusPaths(targetRoot)).filter(overlayIncluded);
    if (remaining.length > 0) {
      throw new EmpiricalError(
        "INTEGRATION_TARGET_MUTATED",
        `Independent validation left target changes: ${remaining.join(", ")}`,
      );
    }
  };
  try {
    for (const path of changed) {
      if (!path || path.startsWith("../") || isAbsolute(path)) {
        throw new Error(`Git returned an unsafe integration overlay path: ${path}`);
      }
      const [baseFile, targetRevisionFile, sourceFile, targetFile] = await Promise.all([
        revisionFile(sourceRoot, path),
        revisionFile(targetRoot, path),
        overlayFile(sourceRoot, path),
        overlayFile(targetRoot, path),
      ]);
      if (baseFile !== targetRevisionFile && !sameOverlayFile(sourceFile, targetFile)) {
        throw new EmpiricalError(
          "INTEGRATION_SOURCE_CONFLICT",
          `Target changed source path ${path} since the feature base`,
        );
      }
      if (sameOverlayFile(sourceFile, targetFile)) continue;
      applied.push({
        path,
        original: targetFile?.bytes ?? null,
        originalMode: targetFile?.mode ?? null,
      });
      const destination = resolve(target, path);
      if (sourceFile === null) {
        await rm(destination, { force: true });
      } else {
        await writeOverlayFile(destination, sourceFile.bytes, sourceFile.mode);
      }
    }
    return restore;
  } catch (error) {
    await restore();
    throw error;
  }
}

function verifyDigestRecord(value: Record<string, unknown>, label: string): void {
  if (typeof value.digest !== "string") throw new Error(`${label} has no digest.`);
  const { digest: recordDigest, ...body } = value;
  if (digestJson(body) !== recordDigest) throw new Error(`${label} failed its digest check.`);
}

function archiveReport(feature: string, deltas: CapabilityDelta[]): ArchiveResult["report"] {
  const capabilities = [...new Set(deltas.map((delta) => delta.capability))].sort();
  let added = 0;
  let modified = 0;
  let removed = 0;
  for (const delta of deltas) {
    for (const requirement of delta.requirements) {
      if (requirement.operation === "added") added += 1;
      else if (requirement.operation === "modified") modified += 1;
      else removed += 1;
    }
  }
  return { feature, capabilities, added, modified, removed, converged: false };
}

function completionRank(level: "implemented" | "verified" | "integrated" | "delivered" | "published"): number {
  return ["implemented", "verified", "integrated", "delivered", "published"].indexOf(level);
}

function emptyIntegrationReport(): IntegrationReport {
  return { scope: "project", selected: [], destinations: [], created: [], updated: [], removed: [], preserved: [], entrypoints: [] };
}

function withTrackerRepositoryRoot(dependencies: TrackerDependencies, root: string): TrackerDependencies {
  return { ...dependencies, repositoryRoot: root };
}

async function existingKnowledgePaths(root: string): Promise<string[]> {
  return freshRepositoryKnowledgePaths(root).catch(() => []);
}

function assertWorkflow(profile: string): asserts profile is Workflow {
  if (profile !== "fast" && profile !== "complex") {
    throw new EmpiricalError("INVALID_PROFILE", `Workflow must be fast or complex, not '${profile}'`);
  }
}

function assertCompletionInput(input: CompletionInput): void {
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) {
    throw new EmpiricalError("INVALID_REVISION", "Completion revision must be a non-negative integer");
  }
  if (!("passed failed awaiting_human blocked".split(" ") as string[]).includes(input.outcome)) {
    throw new EmpiricalError("INVALID_OUTCOME", `Unsupported completion outcome '${String(input.outcome)}'`);
  }
  if (input.evidence !== undefined) {
    throw new EmpiricalError(
      "INVALID_EVIDENCE",
      "Schema 5 does not accept caller-asserted evidence booleans; submit immutable receiptIds",
    );
  }
  for (const id of input.receiptIds ?? []) {
    if (!/^(?:executed|collected)-[a-z0-9-]+$/.test(id)) {
      throw new EmpiricalError("INVALID_EVIDENCE", `Invalid evidence receipt id: ${id}`);
    }
  }
}
