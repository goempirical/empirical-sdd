import type { ExecutionMode, Workflow } from "./protocol.js";

export interface OperationDefinition {
  id: string;
  mcpName: string;
  internalVerb: string;
  handler: string;
  summary: string;
  profiles: readonly Workflow[];
  modes: readonly ExecutionMode[];
  publicCli: boolean;
  readOnly: boolean;
  destructive: boolean;
  idempotent: boolean;
  cliUsage: string;
}

function operation(
  id: string,
  summary: string,
  options: Partial<Pick<OperationDefinition, "profiles" | "modes" | "publicCli" | "readOnly" | "destructive" | "idempotent" | "cliUsage">> = {},
): OperationDefinition {
  return Object.freeze({
    id,
    mcpName: `empirical_${id.replaceAll("-", "_")}`,
    internalVerb: id,
    handler: id.replaceAll("-", "_"),
    summary,
    profiles: options.profiles ?? (["fast", "complex"] as const),
    modes: options.modes ?? (["normal", "yolo"] as const),
    publicCli: options.publicCli ?? false,
    readOnly: options.readOnly ?? false,
    destructive: options.destructive ?? false,
    idempotent: options.idempotent ?? true,
    cliUsage: options.cliUsage ?? "",
  });
}

export const OPERATIONS = Object.freeze([
  operation("init", "Initialize or repair repository context.", { cliUsage: " [--profile fast|complex] [--defaults|--interactive] [--no-integrations]" }),
  operation("adopt", "Adopt an Empirical v1 repository non-destructively.", { cliUsage: " [--profile fast|complex] [--no-integrations]" }),
  operation("configure", "Validate and persist project configuration.", { cliUsage: " [--defaults|--interactive] [configuration options]" }),
  operation("policy", "Read or validate Policy v2.", { readOnly: true }),
  operation("context", "Inspect or refresh repository knowledge."),
  operation("doctor", "Diagnose repository state without mutation.", { readOnly: true }),
  operation("explore", "Return read-only Socratic discovery context.", { readOnly: true, cliUsage: " <problem> [--agent id]" }),
  operation("discovery", "Persist an approved five-pass discovery.", { idempotent: false, cliUsage: " --input <json-file|->" }),
  operation("route", "Classify a request and its risk floor.", { readOnly: true, cliUsage: " <request> [--mode normal|yolo] [--profile fast|complex]" }),
  operation("fast", "Start eligible contract-neutral work.", { profiles: ["fast"], cliUsage: " <request> [--id feature-id]" }),
  operation("complex", "Start behavioral or otherwise material work.", { profiles: ["complex"], cliUsage: " <request> [--id feature-id]" }),
  operation("yolo", "Start or resume work with bounded standing authorization.", { cliUsage: " <request> [--ceiling implemented|verified|integrated|delivered] [--target-branch branch] [--allow-external-agent]" }),
  operation("loop", "Return the selected feature's exact current action.", { readOnly: true }),
  operation("next", "Read the exact current action without mutation.", { readOnly: true }),
  operation("status", "Read exact workflow and completion state.", { readOnly: true }),
  operation("explain", "Explain deterministic state rationale.", { readOnly: true }),
  operation("tracker-configure", "Configure or disable the optional external ticket mirror.", { cliUsage: " --input <json-file|->" }),
  operation("tracker-bind", "Create or attach the selected feature's external ticket.", { idempotent: false, cliUsage: " --input <json-file|->" }),
  operation("tracker-sync", "Converge the selected feature's external ticket to committed local state."),
  operation("complete", "Complete the exact current revision.", { idempotent: false, cliUsage: " --revision N --outcome <passed|failed|awaiting_human|blocked> --summary <text> [--receipt id ...]" }),
  operation("retry", "Resume a blocked exact revision.", { idempotent: false, cliUsage: " --revision N [--actor name]" }),
  operation("verify", "Validate receipts without advancing state.", { readOnly: true }),
  operation("evidence-execute", "Execute one configured command and record an immutable receipt.", { idempotent: false, cliUsage: " --input <json-file|->" }),
  operation("evidence-collect", "Collect immutable artifact evidence.", { idempotent: false, cliUsage: " --input <json-file|->" }),
  operation("integrate", "Replay and integrate against the current target.", {
    profiles: ["complex"],
    cliUsage: " --revision N --target-root <independent-worktree> [--actor name]",
  }),
  operation("deliver", "Deliver through the authorized GitHub ceiling.", {
    profiles: ["complex"],
    destructive: true,
    cliUsage: " --input <json-file|->",
  }),
  operation("publish", "Publish one explicitly authorized immutable version.", {
    profiles: ["complex"],
    modes: ["yolo"],
    destructive: true,
    cliUsage: " --input <json-file|->",
  }),
  operation("archive", "Archive integrated capability projections.", {
    profiles: ["complex"],
    cliUsage: " --revision N [--actor name]",
  }),
  operation("capabilities", "List or read living capability contracts.", { readOnly: true, cliUsage: " [--name capability]" }),
  operation("handoff", "Propose or validate an external-agent handoff.", { readOnly: true, cliUsage: " [--agent id --approval-token token --yes]" }),
  operation("worktree-propose", "Propose exact safe worktree isolation.", { readOnly: true, cliUsage: " <request> --workflow fast|complex [proposal overrides]" }),
  operation("worktree-create", "Create one explicitly approved worktree.", { destructive: true, idempotent: false, cliUsage: " --input <json-file|->" }),
  operation("migrate", "Atomically migrate Schema-4 state to Schema 5."),
  operation("integrations", "Refresh project agent and MCP integrations.", { cliUsage: " [--global [--all]]" }),
] satisfies OperationDefinition[]);

export interface SkillDefinition {
  id: string;
  title: string;
  description: string;
  entryOperation: string;
  stopCondition: string;
}

export const SKILLS = Object.freeze([
  {
    id: "empirical",
    title: "Empirical",
    description: "Automatically initialize, route, track, resume, and complete Empirical work.",
    entryOperation: "route",
    stopCondition: "Done, blocked, awaiting human, or external authorization required.",
  },
] satisfies SkillDefinition[]);

export function assertRegistryIntegrity(): void {
  const operationIds = new Set<string>();
  const mcpNames = new Set<string>();
  const verbs = new Set<string>();
  const handlers = new Set<string>();
  for (const entry of OPERATIONS) {
    if (entry.readOnly && entry.destructive) {
      throw new Error(`Operation ${entry.id} cannot be both read-only and destructive.`);
    }
    for (const [label, value, set] of [
      ["operation id", entry.id, operationIds],
      ["MCP name", entry.mcpName, mcpNames],
      ["internal verb", entry.internalVerb, verbs],
      ["handler", entry.handler, handlers],
    ] as const) {
      if (set.has(value)) {
        throw new Error(`Duplicate ${label}: ${value}`);
      }
      set.add(value);
    }
  }

  const skillIds = new Set<string>();
  for (const skill of SKILLS) {
    if (skillIds.has(skill.id)) {
      throw new Error(`Duplicate skill id: ${skill.id}`);
    }
    skillIds.add(skill.id);
    if (!operationIds.has(skill.entryOperation)) {
      throw new Error(
        `Skill ${skill.id} refers to unknown operation ${skill.entryOperation}.`,
      );
    }
  }
}

assertRegistryIntegrity();

export function operationById(id: string): OperationDefinition | undefined {
  return OPERATIONS.find((entry) => entry.id === id);
}

export function operationAnnotations(id: string): {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
} {
  const definition = operationById(id);
  if (!definition) throw new Error(`Unknown operation metadata: ${id}`);
  return {
    readOnlyHint: definition.readOnly,
    destructiveHint: definition.destructive,
    idempotentHint: definition.idempotent,
  };
}

export function skillById(id: string): SkillDefinition | undefined {
  return SKILLS.find((entry) => entry.id === id);
}
