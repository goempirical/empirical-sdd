import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { EmpiricalProject } from "./core.js";
import { EmpiricalError, asErrorMessage } from "./errors.js";
import { OPERATIONS, operationAnnotations, operationById } from "./operations.js";
import { trackerOAuthAuthorization } from "./tracker-auth.js";
import {
  authorizationSchema,
  executionModeSchema,
  workflowSchema,
} from "./protocol.js";
import {
  discoverTracker,
  parseTrackerBindInput,
  previewTrackerPolicy,
  proposeTrackerStateMapping,
  trackerAttachBindInputSchema,
  trackerBindInputSchema,
  trackerCreateBindInputSchema,
  trackerDiscoveryInputSchema,
  trackerMappingInputSchema,
  trackerPolicySchema,
  trackerSetupChangeSchema,
} from "./tracking.js";
import {
  PRODUCT_VERSION,
  type AgentIntegrationId,
  type TrackerDependencies,
  type TrackerDiscoveryInput,
  type TrackerPolicy,
} from "./types.js";

export interface EmpiricalMcpServerOptions {
  /** Trusted host-only tracker dependencies, including an optional OAuth resolver. */
  trackerDependencies?: TrackerDependencies;
}

const profileSchema = z.enum(["fast", "complex"]);
const changeTypeSchema = z.enum(["feature", "fix", "chore"]);
const agentSchema = z.enum(["codex", "claude", "cursor", "gemini", "windsurf"]);
const evidenceKindSchema = z.enum(["test", "browser", "screenshot", "review", "human"]);
const socraticAnswerSchema = z.object({
  pass: z.enum(["problem", "outcome", "boundaries", "risks", "verification"]),
  title: z.string().min(1),
  question: z.string().min(1),
  answer: z.string().min(1),
  followUp: z.object({
    question: z.string().min(1),
    answer: z.string().min(1),
  }).nullable(),
});
const configurationSchema = {
  evidenceRequired: z.boolean().optional(),
  browserForUi: z.boolean().optional(),
  screenshotForUi: z.boolean().optional(),
  codeReview: z.boolean().optional(),
  isolation: z.enum(["ask", "off"]).optional(),
  base: z.string().min(1).optional(),
  worktreePath: z.string().min(1).optional(),
  branchPattern: z.string().min(1).optional(),
  decisions: z.enum(["required", "off"]).optional(),
};
const deliveryCommitSchema = z.object({
  branch: z.string().min(1),
  paths: z.array(z.string().min(1)).min(1),
  message: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
}).strict();
const trackerSetupSchema = trackerSetupChangeSchema;
// MCP SDK 1.30 advertises only root object schemas. Preserve the core union at
// runtime and mirror its branch applicability in the emitted Draft-7 schema.
const trackerBindToolSchema = z.object({
  root: z.string().optional(),
  mode: z.enum(["create", "attach"]),
  ticket: trackerAttachBindInputSchema.shape.ticket.optional(),
  title: trackerCreateBindInputSchema.shape.title,
  description: trackerCreateBindInputSchema.shape.description,
  replace: trackerCreateBindInputSchema.shape.replace,
  confirmCreateRetry: trackerCreateBindInputSchema.shape.confirmCreateRetry,
}).strict().superRefine(({ root: _root, ...input }, context) => {
  const parsed = trackerBindInputSchema.safeParse(input);
  if (!parsed.success) {
    context.addIssue({
      code: "custom",
      message: parsed.error.issues.map((issue) => issue.message).join("; "),
    });
  }
}).meta({
  oneOf: [
    {
      properties: { mode: { const: "create" } },
      required: ["mode"],
      not: { anyOf: [{ required: ["ticket"] }] },
    },
    {
      properties: { mode: { const: "attach" } },
      required: ["mode", "ticket"],
      not: {
        anyOf: [
          { required: ["title"] },
          { required: ["description"] },
          { required: ["confirmCreateRetry"] },
        ],
      },
    },
  ],
});

export function createMcpServer(
  defaultRoot = mcpDefaultRoot(),
  options: EmpiricalMcpServerOptions = {},
): McpServer {
  const registered = new Set<string>();
  const operationName = (id: string): string => {
    const definition = operationById(id);
    if (!definition) throw new Error(`Unknown MCP registry operation: ${id}`);
    registered.add(id);
    return definition.mcpName;
  };
  const operationSummary = (id: string): string => {
    const definition = operationById(id);
    if (!definition) throw new Error(`Unknown MCP registry operation: ${id}`);
    return definition.summary;
  };
  const server = new McpServer(
    { name: "empirical-sdd", version: PRODUCT_VERSION },
    {
      instructions:
        "Use Empirical through its single registry-backed skill. Route deterministically, keep local workflow state authoritative, mirror committed progress only through the granular tracker operations, record immutable evidence receipts, complete exact revisions, and integrate reviewed deltas against an independent target. Bounded standing authorization never suppresses host prompts or weakens Git, credential, publication, or deletion safety floors. Tracker authentication is OAuth-first through negotiated URL-mode elicitation; raw credentials are never valid tool input or output and must never be pasted into chat.",
    },
  );

  server.registerTool(operationName("explore"), {
    title: "Explore a vague problem",
    description: operationSummary("explore"),
    inputSchema: { root: z.string().optional(), problem: z.string().min(1) },
    annotations: operationAnnotations("explore"),
  }, async ({ root, problem }) => toolResult(async () => (await EmpiricalProject.openReadOnly(root ?? defaultRoot)).explore(problem)));

  server.registerTool(operationName("discovery"), {
    title: "Save or approve Socratic discovery",
    description: operationSummary("discovery"),
    inputSchema: {
      root: z.string().optional(),
      id: z.string().min(1).optional(),
      problem: z.string().min(1),
      answers: z.array(socraticAnswerSchema).max(5),
      approved: z.literal(true).optional(),
    },
    annotations: operationAnnotations("discovery"),
  }, async ({ root, id, problem, answers, approved }) => toolResult(async () => {
    const project = await EmpiricalProject.open(root ?? defaultRoot);
    return project.discovery({
      ...(id ? { id } : {}),
      problem,
      answers,
      ...(approved ? { approved } : {}),
    });
  }));

  server.registerTool(operationName("init"), {
    title: "Initialize Empirical",
    description: operationSummary("init"),
    inputSchema: { root: z.string().optional(), profile: profileSchema.optional(), tracker: trackerSetupSchema.optional(), ...configurationSchema },
    annotations: operationAnnotations("init"),
  }, async ({ root, profile, tracker, evidenceRequired, browserForUi, screenshotForUi, codeReview, isolation, base, worktreePath, branchPattern, decisions }) => toolResult(async () => {
    const initialized = await EmpiricalProject.initialize(root ?? defaultRoot, {
      ...(profile ? { profile } : {}),
      evidence: {
        ...(evidenceRequired !== undefined ? { required: evidenceRequired } : {}),
        ...(browserForUi !== undefined ? { browserForUi } : {}),
        ...(screenshotForUi !== undefined ? { screenshotForUi } : {}),
        ...(codeReview !== undefined ? { codeReview } : {}),
      },
      isolation: {
        ...(isolation ? { mode: isolation } : {}),
        ...(base ? { baseBranch: base } : {}),
        ...(worktreePath ? { worktreePath } : {}),
        ...(branchPattern ? { branchPattern } : {}),
      },
      decisions: { ...(decisions ? { complexRecords: decisions } : {}) },
      ...(tracker ? { tracker } : {}),
      setupComplete: true,
    });
    return { state: initialized.state, config: await initialized.project.config(), integrations: initialized.integrations, knowledge: await initialized.project.context(), next: await initialized.project.next() };
  }));

  server.registerTool(operationName("context"), {
    title: "Refresh repository knowledge",
    description: operationSummary("context"),
    inputSchema: { root: z.string().optional() },
    annotations: operationAnnotations("context"),
  }, async ({ root }) => toolResult(async () => (await EmpiricalProject.open(root ?? defaultRoot)).context()));

  server.registerTool(operationName("handoff"), {
    title: "Offer or authorize agent handoff",
    description: operationSummary("handoff"),
    inputSchema: {
      root: z.string().optional(),
      agent: agentSchema.optional(),
      approvalToken: z.string().length(64).optional(),
      approved: z.literal(true).optional(),
    },
    annotations: operationAnnotations("handoff"),
  }, async ({ root, agent, approvalToken, approved }) => toolResult(async () => {
    const project = await EmpiricalProject.openReadOnly(root ?? defaultRoot);
    if (!agent) return project.handoff();
    if (!approvalToken || approved !== true) {
      throw new EmpiricalError(
        "HANDOFF_APPROVAL_REQUIRED",
        "Agent handoff authorization requires approvalToken and approved: true",
      );
    }
    return project.authorizeHandoff(agent as AgentIntegrationId, approvalToken, approved);
  }));

  server.registerTool(operationName("configure"), {
    title: "Configure Empirical",
    description: operationSummary("configure"),
    inputSchema: { root: z.string().optional(), policy: z.unknown().optional(), tracker: trackerSetupSchema.optional(), ...configurationSchema },
    annotations: operationAnnotations("configure"),
  }, async ({ root, policy, tracker, evidenceRequired, browserForUi, screenshotForUi, codeReview, isolation, base, worktreePath, branchPattern, decisions }) => toolResult(async () => {
    const project = await EmpiricalProject.open(root ?? defaultRoot);
    if (policy !== undefined && tracker !== undefined) {
      throw new EmpiricalError("INVALID_CONFIG", "Configure project policy and tracker setup in separate exact requests");
    }
    if (policy !== undefined) return project.configurePolicy(policy);
    if (tracker?.mode === "apply") await project.previewTracker(tracker.policy);
    const config = await project.configure({
      evidence: {
        ...(evidenceRequired !== undefined ? { required: evidenceRequired } : {}),
        ...(browserForUi !== undefined ? { browserForUi } : {}),
        ...(screenshotForUi !== undefined ? { screenshotForUi } : {}),
        ...(codeReview !== undefined ? { codeReview } : {}),
      },
      isolation: {
        ...(isolation ? { mode: isolation } : {}),
        ...(base ? { baseBranch: base } : {}),
        ...(worktreePath ? { worktreePath } : {}),
        ...(branchPattern ? { branchPattern } : {}),
      },
      decisions: { ...(decisions ? { complexRecords: decisions } : {}) },
      setupComplete: true,
    });
    if (!tracker || tracker.mode === "preserve") return config;
    const trackerPolicy = await project.configureTracker(tracker.mode === "disabled" ? null : tracker.policy);
    return { config, tracker: trackerPolicy };
  }));

  server.registerTool(operationName("adopt"), {
    title: "Adopt Empirical v1",
    description: operationSummary("adopt"),
    inputSchema: { root: z.string().optional(), profile: profileSchema.optional() },
    annotations: operationAnnotations("adopt"),
  }, async ({ root, profile }) => toolResult(async () => {
    const adopted = await EmpiricalProject.adopt(root ?? defaultRoot, { ...(profile ? { profile } : {}), setupComplete: true });
    return { state: adopted.state, integrations: adopted.integrations, next: await adopted.project.next() };
  }));

  server.registerTool(operationName("fast"), {
    title: "Start or resume Fast",
    description: operationSummary("fast"),
    inputSchema: { root: z.string().optional(), request: z.string().min(1), id: z.string().optional() },
    annotations: operationAnnotations("fast"),
  }, async ({ root, request, id }) => toolResult(async () => (await EmpiricalProject.open(root ?? defaultRoot)).fast(request, { ...(id ? { id } : {}) })));

  server.registerTool(operationName("complex"), {
    title: "Start or resume Complex",
    description: operationSummary("complex"),
    inputSchema: { root: z.string().optional(), request: z.string().min(1), id: z.string().optional() },
    annotations: operationAnnotations("complex"),
  }, async ({ root, request, id }) => toolResult(async () => (await EmpiricalProject.open(root ?? defaultRoot)).complex(request, { ...(id ? { id } : {}) })));

  server.registerTool(operationName("route"), {
    title: "Route an Empirical request",
    description: operationSummary("route"),
    inputSchema: {
      root: z.string().optional(),
      request: z.string().min(1),
      mode: executionModeSchema.optional(),
      requestedProfile: workflowSchema.optional(),
      declaredContractNeutral: z.boolean().optional(),
    },
    annotations: operationAnnotations("route"),
  }, async ({ root, request, mode, requestedProfile, declaredContractNeutral }) => toolResult(async () =>
    (await EmpiricalProject.openReadOnly(root ?? defaultRoot)).route(request, {
      ...(mode ? { mode } : {}),
      ...(requestedProfile ? { requestedProfile } : {}),
      ...(declaredContractNeutral !== undefined ? { declaredContractNeutral } : {}),
    })));

  server.registerTool(operationName("yolo"), {
    title: "Start or resume bounded YOLO",
    description: operationSummary("yolo"),
    inputSchema: {
      root: z.string().optional(),
      request: z.string().min(1),
      id: z.string().optional(),
      ceiling: z.enum(["implemented", "verified", "integrated", "delivered"]).optional(),
      targetBranch: z.string().min(1).optional(),
      allowExternalAgent: z.boolean().optional(),
    },
    annotations: operationAnnotations("yolo"),
  }, async ({ root, request, id, ceiling, targetBranch, allowExternalAgent }) => toolResult(async () =>
    (await EmpiricalProject.open(root ?? defaultRoot)).yolo(request, {
      ...(id ? { id } : {}),
      ...(ceiling ? { ceiling } : {}),
      ...(targetBranch ? { targetBranch } : {}),
      ...(allowExternalAgent !== undefined ? { allowExternalAgent } : {}),
    })));

  server.registerTool(operationName("worktree-propose"), {
    title: "Preview isolated Git worktree",
    description: operationSummary("worktree-propose"),
    inputSchema: {
      root: z.string().optional(), request: z.string().min(1), workflow: profileSchema,
      changeType: changeTypeSchema.optional(), id: z.string().optional(), branch: z.string().optional(), path: z.string().optional(), base: z.string().optional(),
    },
    annotations: operationAnnotations("worktree-propose"),
  }, async ({ root, request, workflow, changeType, id, branch, path, base }) => toolResult(async () => {
    const project = await EmpiricalProject.openReadOnly(root ?? defaultRoot);
    return project.proposeWorktree(request, workflow, {
      ...(changeType ? { changeType } : {}), ...(id ? { feature: id } : {}),
      ...(branch ? { branch } : {}), ...(path ? { path } : {}), ...(base ? { base } : {}),
    });
  }));

  server.registerTool(operationName("worktree-create"), {
    title: "Create approved Git worktree",
    description: operationSummary("worktree-create"),
    inputSchema: {
      root: z.string().optional(), request: z.string().min(1), workflow: profileSchema,
      changeType: changeTypeSchema.optional(), id: z.string().optional(), branch: z.string().optional(), path: z.string().optional(), base: z.string().optional(),
      baseCommit: z.string().min(1), activeFeature: z.string().min(1), approvalToken: z.string().length(64),
      approved: z.literal(true),
    },
    annotations: operationAnnotations("worktree-create"),
  }, async ({ root, request, workflow, changeType, id, branch, path, base, baseCommit, activeFeature, approvalToken, approved }) => toolResult(async () => {
    const project = await EmpiricalProject.open(root ?? defaultRoot);
    return project.createWorktree({
      request, workflow, approved,
      ...(changeType ? { changeType } : {}), ...(id ? { feature: id } : {}),
      ...(branch ? { branch } : {}), ...(path ? { path } : {}), ...(base ? { base } : {}),
      baseCommit, activeFeature, approvalToken,
    });
  }));

  server.registerTool(operationName("loop"), {
    title: "Resume active workflow",
    description: operationSummary("loop"),
    inputSchema: { root: z.string().optional() },
    annotations: operationAnnotations("loop"),
  }, async ({ root }) => toolResult(async () => (await EmpiricalProject.openReadOnly(root ?? defaultRoot)).loop()));

  server.registerTool(operationName("next"), {
    title: "Read current action",
    description: operationSummary("next"),
    inputSchema: { root: z.string().optional() },
    annotations: operationAnnotations("next"),
  }, async ({ root }) => toolResult(async () => (await EmpiricalProject.openReadOnly(root ?? defaultRoot)).next()));

  server.registerTool(operationName("explain"), {
    title: "Explain current Empirical state",
    description: operationSummary("explain"),
    inputSchema: { root: z.string().optional() },
    annotations: operationAnnotations("explain"),
  }, async ({ root }) => toolResult(async () => (await EmpiricalProject.openReadOnly(root ?? defaultRoot)).explain()));

  server.registerTool(operationName("tracker-discover"), {
    title: "Discover tracker targets and workflow metadata",
    description: operationSummary("tracker-discover"),
    inputSchema: z.object({
      root: z.string().optional(),
      input: trackerDiscoveryInputSchema,
    }).strict(),
    annotations: operationAnnotations("tracker-discover"),
  }, async ({ root, input }) => toolResult(async () => {
    const effectiveRoot = root ?? defaultRoot;
    const dependencies = trackerDependenciesForRoot(options.trackerDependencies, effectiveRoot);
    await prepareTrackerOAuthHandoff(server, input, dependencies);
    return discoverTracker(input, dependencies);
  }));

  server.registerTool(operationName("tracker-preview"), {
    title: "Preview external ticket tracking",
    description: operationSummary("tracker-preview"),
    inputSchema: z.object({
      root: z.string().optional(),
      policy: trackerPolicySchema,
    }).strict(),
    annotations: operationAnnotations("tracker-preview"),
  }, async ({ root, policy }) => toolResult(async () => {
    const effectiveRoot = root ?? defaultRoot;
    const dependencies = trackerDependenciesForRoot(options.trackerDependencies, effectiveRoot);
    await prepareTrackerOAuthHandoff(server, policy, dependencies);
    return previewTrackerPolicy(policy, dependencies);
  }));

  server.registerTool(operationName("tracker-suggest"), {
    title: "Propose semantic tracker state mapping",
    description: operationSummary("tracker-suggest"),
    inputSchema: z.object({
      root: z.string().optional(),
      ...trackerMappingInputSchema.shape,
    }).strict(),
    annotations: operationAnnotations("tracker-suggest"),
  }, async ({ root, input, stateParentId }) => toolResult(async () => {
    const effectiveRoot = root ?? defaultRoot;
    const dependencies = trackerDependenciesForRoot(options.trackerDependencies, effectiveRoot);
    await prepareTrackerOAuthHandoff(server, input, dependencies);
    return proposeTrackerStateMapping({ input, stateParentId }, dependencies);
  }));

  server.registerTool(operationName("tracker-configure"), {
    title: "Configure external ticket tracking",
    description: operationSummary("tracker-configure"),
    inputSchema: z.object({
      root: z.string().optional(),
      policy: trackerPolicySchema.nullable(),
    }).strict(),
    annotations: operationAnnotations("tracker-configure"),
  }, async ({ root, policy }) => toolResult(async () => {
    const effectiveRoot = root ?? defaultRoot;
    const dependencies = trackerDependenciesForRoot(options.trackerDependencies, effectiveRoot);
    if (policy) await prepareTrackerOAuthHandoff(server, policy, dependencies);
    return (await EmpiricalProject.open(effectiveRoot)).configureTracker(policy, dependencies);
  }));

  server.registerTool(operationName("tracker-bind"), {
    title: "Create or attach an external ticket",
    description: operationSummary("tracker-bind"),
    inputSchema: trackerBindToolSchema,
    annotations: operationAnnotations("tracker-bind"),
  }, async ({ root, ...input }) => toolResult(async () => {
    const effectiveRoot = root ?? defaultRoot;
    const dependencies = trackerDependenciesForRoot(options.trackerDependencies, effectiveRoot);
    const project = await EmpiricalProject.open(effectiveRoot);
    const policy = await project.trackerPolicy();
    if (policy) await prepareTrackerOAuthHandoff(server, policy, dependencies);
    return project.bindTracker(parseTrackerBindInput(input), dependencies);
  }));

  server.registerTool(operationName("tracker-sync"), {
    title: "Synchronize external ticket tracking",
    description: operationSummary("tracker-sync"),
    inputSchema: { root: z.string().optional() },
    annotations: operationAnnotations("tracker-sync"),
  }, async ({ root }) => toolResult(async () => {
    const effectiveRoot = root ?? defaultRoot;
    const dependencies = trackerDependenciesForRoot(options.trackerDependencies, effectiveRoot);
    const project = await EmpiricalProject.open(effectiveRoot);
    const policy = await project.trackerPolicy();
    if (policy) await prepareTrackerOAuthHandoff(server, policy, dependencies);
    return project.syncTracker(dependencies);
  }));

  server.registerTool(operationName("complete"), {
    title: "Complete current action",
    description: operationSummary("complete"),
    inputSchema: {
      root: z.string().optional(), revision: z.number().int().nonnegative(),
      outcome: z.enum(["passed", "failed", "awaiting_human", "blocked"]),
      summary: z.string().min(1), actor: z.string().optional(),
      receiptIds: z.array(z.string().regex(/^(?:executed|collected)-[a-z0-9-]+$/)).optional(),
    },
    annotations: operationAnnotations("complete"),
  }, async ({ root, revision, outcome, summary, actor, receiptIds }) => toolResult(async () => {
    const project = await EmpiricalProject.open(root ?? defaultRoot);
    return project.complete({ revision, outcome, summary, ...(actor ? { actor } : {}), ...(receiptIds ? { receiptIds } : {}) });
  }));

  server.registerTool(operationName("archive"), {
    title: "Legacy archive boundary",
    description: operationSummary("archive"),
    inputSchema: { root: z.string().optional(), revision: z.number().int().nonnegative(), actor: z.string().optional() },
    annotations: operationAnnotations("archive"),
  }, async ({ root, revision, actor }) => toolResult(async () => (await EmpiricalProject.open(root ?? defaultRoot)).archive(revision, actor)));

  server.registerTool(operationName("status"), {
    title: "Read workflow status",
    description: operationSummary("status"),
    inputSchema: { root: z.string().optional() },
    annotations: operationAnnotations("status"),
  }, async ({ root }) => toolResult(async () => (await EmpiricalProject.openReadOnly(root ?? defaultRoot)).statusReport()));

  server.registerTool(operationName("verify"), {
    title: "Validate evidence",
    description: operationSummary("verify"),
    inputSchema: { root: z.string().optional() },
    annotations: operationAnnotations("verify"),
  }, async ({ root }) => toolResult(async () => (await EmpiricalProject.openReadOnly(root ?? defaultRoot)).verify()));

  server.registerTool(operationName("evidence-execute"), {
    title: "Execute configured evidence",
    description: operationSummary("evidence-execute"),
    inputSchema: {
      root: z.string().optional(),
      commandId: z.string().regex(/^[a-z][a-z0-9-]*$/),
      criteria: z.array(z.string().regex(/^AC-[A-Z0-9]+(?:-[A-Z0-9]+)*$/)).min(1),
      evidenceKinds: z.array(evidenceKindSchema).min(1).optional(),
      summary: z.string().min(1),
    },
    annotations: operationAnnotations("evidence-execute"),
  }, async ({ root, commandId, criteria, evidenceKinds, summary }) => toolResult(async () =>
    (await EmpiricalProject.open(root ?? defaultRoot)).executeEvidence({
      commandId,
      criteria,
      ...(evidenceKinds ? { evidenceKinds } : {}),
      summary,
    })));

  server.registerTool(operationName("evidence-collect"), {
    title: "Collect artifact evidence",
    description: operationSummary("evidence-collect"),
    inputSchema: {
      root: z.string().optional(),
      criteria: z.array(z.string().regex(/^AC-[A-Z0-9]+(?:-[A-Z0-9]+)*$/)).min(1),
      evidenceKinds: z.array(evidenceKindSchema).min(1),
      summary: z.string().min(1),
      collector: z.string().min(1),
      artifacts: z.array(z.object({
        path: z.string().min(1),
        mediaType: z.string().min(1),
      }).strict()).min(1),
    },
    annotations: operationAnnotations("evidence-collect"),
  }, async ({ root, criteria, evidenceKinds, summary, collector, artifacts }) => toolResult(async () =>
    (await EmpiricalProject.open(root ?? defaultRoot)).collectEvidence({
      criteria,
      evidenceKinds,
      summary,
      collector,
      artifacts,
    })));

  server.registerTool(operationName("retry"), {
    title: "Resume a paused workflow",
    description: operationSummary("retry"),
    inputSchema: { root: z.string().optional(), revision: z.number().int().nonnegative(), actor: z.string().optional() },
    annotations: operationAnnotations("retry"),
  }, async ({ root, revision, actor }) => toolResult(async () => (await EmpiricalProject.open(root ?? defaultRoot)).retry(revision, actor)));

  server.registerTool(operationName("doctor"), {
    title: "Inspect project health",
    description: operationSummary("doctor"),
    inputSchema: { root: z.string().optional() },
    annotations: operationAnnotations("doctor"),
  }, async ({ root }) => toolResult(async () => (await EmpiricalProject.openReadOnly(root ?? defaultRoot)).doctor()));

  server.registerTool(operationName("migrate"), {
    title: "Migrate Empirical schema",
    description: operationSummary("migrate"),
    inputSchema: { root: z.string().optional() },
    annotations: operationAnnotations("migrate"),
  }, async ({ root }) => toolResult(async () => (await EmpiricalProject.open(root ?? defaultRoot, { migrate: false })).migrate()));

  server.registerTool(operationName("capabilities"), {
    title: "Read living capability specifications",
    description: operationSummary("capabilities"),
    inputSchema: { root: z.string().optional(), name: z.string().optional() },
    annotations: operationAnnotations("capabilities"),
  }, async ({ root, name }) => toolResult(async () => {
    const project = await EmpiricalProject.openReadOnly(root ?? defaultRoot);
    return name ? { name, contents: await project.capability(name) } : project.capabilities();
  }));

  server.registerTool(operationName("policy"), {
    title: "Read project policy",
    description: operationSummary("policy"),
    inputSchema: { root: z.string().optional() },
    annotations: operationAnnotations("policy"),
  }, async ({ root }) => toolResult(async () => (await EmpiricalProject.openReadOnly(root ?? defaultRoot)).policy()));

  server.registerTool(operationName("integrate"), {
    title: "Integrate reviewed capability deltas",
    description: operationSummary("integrate"),
    inputSchema: {
      root: z.string().optional(),
      revision: z.number().int().nonnegative(),
      targetRoot: z.string().min(1),
      actor: z.string().optional(),
    },
    annotations: operationAnnotations("integrate"),
  }, async ({ root, revision, targetRoot, actor }) => toolResult(async () =>
    (await EmpiricalProject.open(root ?? defaultRoot)).integrate(revision, targetRoot, actor)));

  server.registerTool(operationName("deliver"), {
    title: "Deliver through protected GitHub pull requests",
    description: operationSummary("deliver"),
    inputSchema: {
      root: z.string().optional(),
      revision: z.number().int().nonnegative(),
      source: deliveryCommitSchema,
      evidence: deliveryCommitSchema,
      actor: z.string().optional(),
    },
    annotations: operationAnnotations("deliver"),
  }, async ({ root, revision, source, evidence, actor }) => toolResult(async () =>
    (await EmpiricalProject.open(root ?? defaultRoot)).deliver({
      revision,
      source,
      evidence,
      ...(actor ? { actor } : {}),
    })));

  server.registerTool(operationName("publish"), {
    title: "Publish one explicitly authorized immutable version",
    description: operationSummary("publish"),
    inputSchema: {
      root: z.string().optional(),
      revision: z.number().int().nonnegative(),
      authorization: authorizationSchema,
      feature: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      packageName: z.string().min(1),
      version: z.string().min(1),
      distTag: z.string().min(1),
      commit: z.string().regex(/^[a-f0-9]{7,64}$/),
      approved: z.literal(true),
      actor: z.string().optional(),
    },
    annotations: operationAnnotations("publish"),
  }, async ({ root, revision, authorization, feature, packageName, version, distTag, commit, actor }) => toolResult(async () =>
    (await EmpiricalProject.open(root ?? defaultRoot, { feature })).publish({
      revision,
      authorization,
      packageName,
      version,
      distTag,
      commit,
      approved: true,
      ...(actor ? { actor } : {}),
    })));

  server.registerTool(operationName("integrations"), {
    title: "Refresh project agent discovery",
    description: operationSummary("integrations"),
    inputSchema: { root: z.string().optional() },
    annotations: operationAnnotations("integrations"),
  }, async ({ root }) => toolResult(async () => (await EmpiricalProject.open(root ?? defaultRoot)).integrations()));

  const missing = OPERATIONS.filter((definition) => !registered.has(definition.id));
  if (missing.length > 0) {
    throw new Error(`MCP registry parity is incomplete: ${missing.map((entry) => entry.id).join(", ")}`);
  }

  return server;
}

export async function runMcpServer(
  defaultRoot?: string,
  options: EmpiricalMcpServerOptions = {},
): Promise<void> {
  const server = createMcpServer(defaultRoot, options);
  await server.connect(new StdioServerTransport());
}

function mcpDefaultRoot(): string {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

async function prepareTrackerOAuthHandoff(
  server: McpServer,
  subject: TrackerPolicy | TrackerDiscoveryInput,
  dependencies: TrackerDependencies,
): Promise<void> {
  const elicitation = server.server.getClientCapabilities()?.elicitation;
  if (!isRecord(elicitation) || !isRecord(elicitation.url)) return;
  const authorization = await trackerOAuthAuthorization(subject, dependencies);
  if (!authorization) return;
  try {
    await server.server.elicitInput({
      mode: "url",
      message: authorization.message,
      elicitationId: authorization.elicitationId,
      url: authorization.url,
    });
  } catch {
    // A failed or unsupported out-of-band handoff must never degrade to a
    // form. The operation continues through the ordinary host-only fallback.
  }
}

function trackerDependenciesForRoot(
  dependencies: TrackerDependencies | undefined,
  root: string,
): TrackerDependencies {
  return { ...(dependencies ?? {}), repositoryRoot: root };
}

async function toolResult(operation: () => Promise<unknown>) {
  try {
    const value = await operation();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
      structuredContent: isRecord(value) ? value : { value },
    };
  } catch (error) {
    return { isError: true, content: [{ type: "text" as const, text: asErrorMessage(error) }] };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
