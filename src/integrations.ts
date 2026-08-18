import { lstat, readFile, rm, rmdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  AGENT_CATALOG_SOURCE,
  agentSkillTarget,
  agentSkillTargetPath,
  detectAgentSkillTargets,
  globalAgentSkillTargets,
  resolveAgentSkillTargetId,
  type AgentSkillTargetId,
  type GlobalAgentSkillTarget,
} from "./agent-catalog.js";
import { EmpiricalError } from "./errors.js";
import { SKILLS } from "./operations.js";
import { isFile, readJson, writeJsonAtomic, writeTextAtomic } from "./storage.js";
import type { IntegrationReport } from "./types.js";

const START = "<!-- empirical-sdd:start -->";
const END = "<!-- empirical-sdd:end -->";
const MANAGED_FILE_MARKER = "empirical-sdd:managed-file";
const OBSOLETE_GLOBAL_ENTRYPOINTS = [
  "empirical",
  "empirical-explore",
  "empirical-fast",
  "empirical-complex",
  "empirical-loop",
  "empirical-socratic",
  "empirical-spec",
  "empirical-yolo",
] as const;
const OBSOLETE_PROJECT_ENTRYPOINTS = [
  "empirical-explore",
  "empirical-fast",
  "empirical-complex",
  "empirical-init",
  "empirical-loop",
  "empirical-socratic",
  "empirical-spec",
  "empirical-yolo",
] as const;
const GLOBAL_SELECTION_SCHEMA = 1 as const;
const GLOBAL_SELECTION_OWNER = "empirical-sdd" as const;
const UNVERIFIED_RUNTIME_GUIDANCE = "Skill files installed; invocation and reload guidance for this runtime has not been verified.";

const PROJECT_GUIDANCE = `${START}
## Empirical repository workflow

When \`.empirical/config.json\` has \`schemaVersion: 5\` and
\`setupComplete: true\`, automatically use the repository-local Empirical
workflow for requests to build, add, implement, change, fix, refactor, remove,
migrate, upgrade, change tests, or continue repository work. The user does not
need to mention Empirical. Read-only explanation and inspection stay outside
the workflow.

Read \`.agents/skills/empirical/SKILL.md\` (or the native project copy) for the
full contract. Use Empirical MCP operations first and private
\`empirical __internal\` fallbacks only when MCP is unavailable. If the config
is missing, invalid, or incomplete, do not initialize implicitly; tell the user
to invoke \`empirical-init\` explicitly.
${END}`;

const INIT_SKILL_BODY = `# Empirical Init

Use this skill only when the user explicitly asks to initialize, set up, or
repair Empirical in the current repository. Attached text is setup context,
never a feature request.

1. Inspect \`.empirical/config.json\`, manifests, documentation, source, tests,
   and Git base without writing. Determine whether this is first setup or a
   repair. Preserve existing configuration values and durable workflow history
   unless the user explicitly changes a value.
2. Before any mutation, render the complete Empirical setup summary for
   Verification, Parallel work, Decisions, and Tracker. Tracker MUST show an
   explicit Local-only option. On repair, Preserve current tracker is the
   default and MUST make no provider request. Offer Apply recommended settings
   (or Keep current settings), Customize, Configure tracker, and Cancel. On
   Customize, visit one section at a time and end with a complete Save, Edit, or
   Cancel review.
3. Tracker configuration selects Linear, GitHub Projects, or Jira plus
   credential environment-variable names only. Call \`empirical_tracker_discover\`
   to show accessible workspaces/sites, teams/repositories, projects, issue
   types, fields, and states by name. Propose all seven semantic phase mappings;
   call \`empirical_tracker_suggest\` for the selected workflow parent, allow
   shared states, show ambiguity, and obtain an explicit choice for every tied
   or incompatible phase. Select off/manual/ensure ticket behavior and blockers-final,
   milestones, or revisions visibility. Call \`empirical_tracker_preview\` and
   display its complete secret-free effective policy before Save.
4. Cancel stops without calling \`empirical_init\`, \`empirical_context\`, or a
   private mutating fallback. After confirmation, call \`empirical_init\` with
   all four explicit evidence booleans plus isolation, base, path, branch,
   decision policy, and the explicit preserve/disabled/applied tracker change.
   The private fallback is \`empirical __internal init\` with equivalent flags
   and a strict \`--tracker-input\` JSON document; discovery and preview remain
   separate read-only private operations.
5. Call \`empirical_context\` when context is missing or stale and replace every
   reported refinement-required topic with repository-grounded knowledge. The
   private fallback is \`empirical __internal context\`.
6. Ensure project integrations are reconciled by initialization. Report exact
   configuration, context, created, updated, removed, and preserved outcomes,
   including whether automatic repository activation is ready.
7. Stop after setup or repair. Do not call route, discovery, fast, complex,
   yolo, loop, complete, tracker binding, handoff, integrate, deliver, publish,
   or archive, and do not create or select feature workflow state.

Never scan other repositories, overwrite unmanaged files, follow unsafe paths,
or claim automatic activation for a repository without valid completed config.`;

const LOCAL_AUTOMATIC_SKILL_BODY = `# Empirical

Automatically route, track, resume, and complete Empirical work in this
initialized repository. Use this workflow for ordinary repository mutations;
the user does not need to mention Empirical or choose a profile.

1. First validate that \`.empirical/config.json\` has \`schemaVersion: 5\` and
   \`setupComplete: true\`. If it does not, do not initialize or create feature
   state; ask the user to invoke \`empirical-init\` explicitly.
2. If selected non-terminal work exists, call \`empirical_loop\` with no request or
   profile and resume the returned action. Attached text never replaces active
   work. The private fallback is \`empirical __internal loop\`.
3. For a genuinely vague new idea, call \`empirical_explore\` for repository and
   capability context, then call \`empirical_discovery\` with empty answers to
   create the draft and receive its first nextQuestion. Ask only the returned
   pass or material follow-up, one at a time, and resubmit the ordered answers
   after each response. The five passes are problem/user, observable outcome,
   boundaries/non-goals, risk/failure, and verification. Show the returned exact
   refined contract and wait for approval before calling \`empirical_discovery\`
   with approved true.
   Private fallbacks are \`empirical __internal explore\` and
   \`empirical __internal discovery --input <json-file>\`.
4. For concrete work, call \`empirical_fast\` only when it is explicit, tiny,
   localized, reversible, low-risk, and non-UI. Call empirical_complex for
   everything else, including UI, architecture, public APIs, security,
   permissions, payments, migrations, dependencies, infrastructure, or
   cross-cutting work. Private fallbacks are \`empirical __internal fast\` and
   \`empirical __internal complex\`; these are agent operations, not user commands.
5. When the user explicitly requests autonomous progress, call \`empirical_yolo\`
   with the exact request and a bounded implemented, verified, integrated, or
   delivered ceiling. Default to integrated only when no lower ceiling is
   requested. YOLO never authorizes publication and never weakens host, Git,
   credential, evidence, deletion, or branch-protection safety. Its private
   fallback is \`empirical __internal yolo\`.
6. Show any worktree proposal exactly and wait for approval before calling the
   approved creation operation. Never stash, force, or replace selected work.
7. Treat Empirical's local journal as authoritative. If .empirical/tracker.json
   is absent or ticket behavior is off, remain local-only/off and make no
   provider requests. In manual mode use \`empirical_tracker_bind\` only for the
   user's explicit create or attach choice and never replace a binding
   implicitly. In ensure mode, \`empirical_tracker_sync\` validates a referenced
   ticket, reconciles the stable feature marker, or creates exactly once when no
   unique ticket exists; ambiguity requires reconciliation and never a guess.
   After each local workflow mutation is durably committed, call
   \`empirical_tracker_sync\`. It publishes only configured milestone comments
   and receipt-approved safe evidence, preserves user-authored descriptions,
   and retries durable unacknowledged effects. A remote failure leaves local
   progress intact; report local-only, off, synced, pending, or failed health.
   Tracker operations are granular MCP tools, not additional skills or user
   commands.
8. Execute every returned action, create immutable evidence receipts with the
   configured commands or collected artifacts, complete its exact revision with
   receipt ids, consume the response as the next action, and integrate reviewed
   capability deltas against an independent target. When Context is returned,
   call empirical_context, inspect repository evidence, replace every reported
   refinement-required topic, remove its managed marker, call empirical_context
   again, and complete only when stale, missing, and refinementRequired are all
   empty. Report the exact highest completion level. Stop only at Done, Blocked,
   or Awaiting Human.
9. After Complex Specify passes, \`empirical_handoff\` may offer Continue here,
   Save for later, or one detected agent. Detection and Save launch nothing;
   another runtime requires explicit approval of its exact target, cwd, and argv.

Do not invent state, weaken acceptance criteria, expose credentials, or persist
private chain-of-thought. Files under .empirical/ are the durable source of truth.`;

function skillContent(
  name: string,
  description: string,
  body: string,
  explicitOnly = false,
): string {
  const invocationMetadata = explicitOnly ? "disable-model-invocation: true\n" : "";
  return `---\nname: ${name}\ndescription: ${description}\n${invocationMetadata}---\n\n<!-- ${MANAGED_FILE_MARKER} -->\n${body}\n\nUse Empirical MCP operations first. Use empirical __internal only when MCP is unavailable; it is a private agent fallback, never a command for the user to run.\n`;
}

const CODEX_EXPLICIT_ONLY_METADATA = `# ${MANAGED_FILE_MARKER}
policy:
  allow_implicit_invocation: false
`;

const LOCAL_EMPIRICAL_SKILL = skillContent(
  "empirical",
  "Automatically route repository-changing requests through this initialized repository's Empirical workflow; skip read-only explanation or inspection.",
  LOCAL_AUTOMATIC_SKILL_BODY,
);

type RegistrySkillId = typeof SKILLS[number]["id"];

const SKILL_BODIES: Record<RegistrySkillId, string> = {
  "empirical-init": INIT_SKILL_BODY,
};

export const EMPIRICAL_AGENT_SKILLS = Object.freeze(
  SKILLS.map((definition) => ({
    name: definition.id,
    description: definition.description,
    content: skillContent(
      definition.id,
      definition.description,
      SKILL_BODIES[definition.id as RegistrySkillId]!,
      true,
    ),
    artifacts: [
      {
        path: "SKILL.md",
        content: skillContent(
          definition.id,
          definition.description,
          SKILL_BODIES[definition.id as RegistrySkillId]!,
          true,
        ),
      },
      { path: join("agents", "openai.yaml"), content: CODEX_EXPLICIT_ONLY_METADATA },
    ],
  })),
);

export type EmpiricalAgentSkill = typeof EMPIRICAL_AGENT_SKILLS[number];
export type EmpiricalAgentSkillName = RegistrySkillId;
export const EMPIRICAL_AGENT_SKILL_NAMES: readonly EmpiricalAgentSkillName[] =
  EMPIRICAL_AGENT_SKILLS.map((skill) => skill.name);

const MCP_SERVER = {
  command: "empirical",
  args: ["mcp"],
};
const CODEX_MCP_START = "# empirical-sdd:mcp:start";
const CODEX_MCP_END = "# empirical-sdd:mcp:end";
const CODEX_MCP_BLOCK = `${CODEX_MCP_START}
[mcp_servers.empirical]
command = "empirical"
args = ["mcp"]
${CODEX_MCP_END}`;

export interface ProjectIntegrationInspection {
  ready: boolean;
  required: string[];
  missing: string[];
  drifted: string[];
}

export interface InstallGlobalAgentSkillsOptions {
  all?: boolean;
  agents?: readonly string[];
  pathValue?: string;
}

interface GlobalSelectionManifest {
  schemaVersion: typeof GLOBAL_SELECTION_SCHEMA;
  managedBy: typeof GLOBAL_SELECTION_OWNER;
  catalogCommit: typeof AGENT_CATALOG_SOURCE.commit;
  selected: AgentSkillTargetId[];
}

interface GlobalSelectionRead {
  selected: AgentSkillTargetId[] | null;
  warning: string | null;
  writable: boolean;
}

export async function managedGlobalAgentIds(homeRoot = homedir()): Promise<AgentSkillTargetId[]> {
  const home = validateHomeRoot(homeRoot);
  const manifest = await readGlobalSelection(home);
  if (manifest.selected) return manifest.selected;
  const managed: AgentSkillTargetId[] = [];
  for (const id of ["codex", "claude-code", "cursor", "gemini-cli", "windsurf"] as const) {
    const definition = agentSkillTarget(id) as GlobalAgentSkillTarget;
    if (await hasManagedGlobalTarget(home, definition)) managed.push(definition.id);
  }
  return managed;
}

export async function installedGlobalAgentIds(homeRoot = homedir()): Promise<AgentSkillTargetId[]> {
  const home = validateHomeRoot(homeRoot);
  const installed: AgentSkillTargetId[] = [];
  const roots = new Map<string, boolean>();
  for (const definition of globalAgentSkillTargets()) {
    const root = agentSkillTargetPath(home, definition);
    let managed = roots.get(root);
    if (managed === undefined) {
      managed = await hasManagedGlobalTarget(home, definition);
      roots.set(root, managed);
    }
    if (managed) installed.push(definition.id);
  }
  return installed;
}

export async function installProjectIntegrations(root: string): Promise<IntegrationReport> {
  const report = emptyReport("project");

  for (const filename of ["AGENTS.md", "CLAUDE.md", "GEMINI.md"]) {
    await mergeManagedMarkdownBlock(root, join(root, filename), PROJECT_GUIDANCE, report);
  }
  await writeManagedFile(
    root,
    join(root, ".agents", "skills", "empirical", "SKILL.md"),
    LOCAL_EMPIRICAL_SKILL,
    report,
  );
  await writeManagedFile(
    root,
    join(root, ".claude", "skills", "empirical", "SKILL.md"),
    LOCAL_EMPIRICAL_SKILL,
    report,
  );
  for (const path of obsoleteProjectTargets(root)) {
    await removeManagedFile(root, path, report);
  }

  await mergeMcpJson(root, join(root, ".mcp.json"), report);
  await mergeMcpJson(root, join(root, ".cursor", "mcp.json"), report);
  await mergeMcpJson(root, join(root, ".gemini", "settings.json"), report, { cwd: "." });
  await mergeCodexToml(root, join(root, ".codex", "config.toml"), report);
  return report;
}

export async function inspectProjectIntegrations(
  rootInput: string,
): Promise<ProjectIntegrationInspection> {
  const root = resolve(rootInput);
  const targets = [
    ...["AGENTS.md", "CLAUDE.md", "GEMINI.md"].map((label) => ({
      label,
      inspect: (contents: string) => hasExactManagedBlock(contents, START, END, PROJECT_GUIDANCE),
    })),
    ...[
      ".agents/skills/empirical/SKILL.md",
      ".claude/skills/empirical/SKILL.md",
    ].map((label) => ({
      label,
      inspect: (contents: string) => contents === LOCAL_EMPIRICAL_SKILL,
    })),
    {
      label: ".mcp.json",
      inspect: (contents: string) => hasExactMcpEntry(contents),
    },
    {
      label: ".cursor/mcp.json",
      inspect: (contents: string) => hasExactMcpEntry(contents),
    },
    {
      label: ".gemini/settings.json",
      inspect: (contents: string) => hasExactMcpEntry(contents, { cwd: "." }),
    },
    {
      label: ".codex/config.toml",
      inspect: (contents: string) => hasExactManagedBlock(
        contents,
        CODEX_MCP_START,
        CODEX_MCP_END,
        CODEX_MCP_BLOCK,
      ),
    },
  ];
  const inspected = await Promise.all(targets.map(async (target) => ({
    label: target.label,
    state: await inspectProjectIntegrationTarget(root, target.label, target.inspect),
  })));
  const missing = inspected
    .filter((target) => target.state === "missing")
    .map((target) => target.label)
    .sort();
  const drifted = inspected
    .filter((target) => target.state === "drifted")
    .map((target) => target.label)
    .sort();
  return {
    ready: missing.length === 0 && drifted.length === 0,
    required: targets.map((target) => target.label).sort(),
    missing,
    drifted,
  };
}

export async function installGlobalAgentSkills(
  homeRoot = homedir(),
  options: InstallGlobalAgentSkillsOptions = {},
): Promise<IntegrationReport> {
  const home = validateHomeRoot(homeRoot);
  if (options.all && options.agents) {
    throw new EmpiricalError("INVALID_ARGUMENT", "Choose either all agents or explicit agents, not both");
  }
  const detected = await detectAgentSkillTargets({
    homeRoot: home,
    ...(options.pathValue !== undefined ? { pathValue: options.pathValue } : {}),
  });
  const detectedIds = new Set(detected);
  for (const id of await managedGlobalAgentIds(home)) detectedIds.add(id);

  const explicitIds = options.agents
    ? resolveRequestedAgentIds(options.agents)
    : null;
  const requestedIds = explicitIds
    ? new Set(explicitIds)
    : options.all
      ? new Set(globalAgentSkillTargets().map((definition) => definition.id))
      : detectedIds;
  const selected = globalAgentSkillTargets().filter((definition) => requestedIds.has(definition.id));
  const report = emptyReport("global");
  report.selected = selected.map((definition) => definition.id);
  report.destinations = [...new Set(selected.map((definition) => agentSkillTargetPath(home, definition)))];
  report.entrypoints = selected.map((definition) => ({
    id: definition.id,
    agent: definition.label,
    kind: "skill",
    artifactRoot: agentSkillTargetPath(home, definition),
    skills: [...EMPIRICAL_AGENT_SKILL_NAMES],
    invocations: definition.invocation
      ? EMPIRICAL_AGENT_SKILLS.map((skill) => invocationFor(definition.invocation!, skill.name))
      : [],
    reload: definition.reload ?? UNVERIFIED_RUNTIME_GUIDANCE,
    guidanceVerified: Boolean(definition.invocation && definition.reload),
    projectMcp: definition.projectMcp === true,
    handoff: definition.handoff === true,
  }));

  for (const [skillRoot, definitions] of groupedGlobalTargets(home)) {
    const selectedRoot = definitions.some((definition) => requestedIds.has(definition.id));
    if (selectedRoot) {
      for (const skill of EMPIRICAL_AGENT_SKILLS) {
        for (const artifact of skill.artifacts) {
          await writeManagedFile(home, join(skillRoot, skill.name, artifact.path), artifact.content, report);
        }
      }
    } else if (options.agents !== undefined || options.all) {
      for (const skill of EMPIRICAL_AGENT_SKILLS) {
        for (const artifact of skill.artifacts) {
          await removeManagedFile(home, join(skillRoot, skill.name, artifact.path), report);
        }
        await removeEmptyDirectory(join(skillRoot, skill.name));
      }
    }
    for (const obsolete of OBSOLETE_GLOBAL_ENTRYPOINTS) {
      if (obsolete === "empirical" && selectedRoot && !(await hasManagedCurrentGlobalSkill(home, skillRoot))) {
        const legacy = join(skillRoot, obsolete, "SKILL.md");
        if (await isSafeRegularFile(home, legacy)) {
          const label = `${relativeLabel(home, legacy)} (kept until empirical-init is fully installed)`;
          if (!report.preserved.includes(label)) report.preserved.push(label);
        }
        continue;
      }
      await removeManagedFile(home, join(skillRoot, obsolete, "SKILL.md"), report);
    }
  }
  await writeGlobalSelection(home, report.selected, report);
  return report;
}

export async function uninstallGlobalAgentSkills(
  homeRoot = homedir(),
): Promise<IntegrationReport> {
  const home = validateHomeRoot(homeRoot);
  const selection = await readGlobalSelection(home);
  const selectedIds = new Set(
    selection.selected ?? (await installedGlobalAgentIds(home)),
  );
  const selected = globalAgentSkillTargets()
    .filter((definition) => selectedIds.has(definition.id));
  const report = emptyReport("global");
  report.selected = selected.map((definition) => definition.id);
  report.destinations = [
    ...new Set(selected.map((definition) => agentSkillTargetPath(home, definition))),
  ];

  for (const [skillRoot] of groupedGlobalTargets(home)) {
    for (const skill of EMPIRICAL_AGENT_SKILLS) {
      for (const artifact of skill.artifacts) {
        await removeManagedFile(home, join(skillRoot, skill.name, artifact.path), report);
      }
      await removeEmptyDirectory(join(skillRoot, skill.name));
    }
    for (const name of OBSOLETE_GLOBAL_ENTRYPOINTS) {
      await removeManagedFile(home, join(skillRoot, name, "SKILL.md"), report);
    }
  }
  await removeGlobalSelection(home, report);
  return report;
}

function emptyReport(scope: IntegrationReport["scope"]): IntegrationReport {
  return { scope, selected: [], destinations: [], created: [], updated: [], removed: [], preserved: [], entrypoints: [] };
}

function obsoleteProjectTargets(root: string): string[] {
  const legacySkills = OBSOLETE_PROJECT_ENTRYPOINTS.flatMap((name) => [
    join(root, ".agents", "skills", name, "SKILL.md"),
    join(root, ".claude", "skills", name, "SKILL.md"),
  ]);
  const legacyCommands = ["empirical", ...OBSOLETE_PROJECT_ENTRYPOINTS].flatMap((name) => [
    join(root, ".cursor", "commands", `${name}.md`),
    join(root, ".gemini", "commands", `${name}.toml`),
    join(root, ".windsurf", "workflows", `${name}.md`),
  ]);
  return [...legacySkills, ...legacyCommands];
}

async function hasManagedGlobalTarget(home: string, definition: GlobalAgentSkillTarget): Promise<boolean> {
  const root = agentSkillTargetPath(home, definition);
  for (const name of [...EMPIRICAL_AGENT_SKILL_NAMES, ...OBSOLETE_GLOBAL_ENTRYPOINTS]) {
    const path = join(root, name, "SKILL.md");
    if (await isSafeRegularFile(home, path) && (await readFile(path, "utf8")).includes(MANAGED_FILE_MARKER)) {
      return true;
    }
  }
  return false;
}

async function hasManagedCurrentGlobalSkill(home: string, root: string): Promise<boolean> {
  for (const skill of EMPIRICAL_AGENT_SKILLS) {
    for (const artifact of skill.artifacts) {
      const path = join(root, skill.name, artifact.path);
      if (!(await isSafeRegularFile(home, path))) return false;
      if (!(await readFile(path, "utf8")).includes(MANAGED_FILE_MARKER)) return false;
    }
  }
  return true;
}

function invocationFor(
  invocation: string,
  skillName: EmpiricalAgentSkillName,
): string {
  return invocation.replace(/empirical$/, skillName);
}

function resolveRequestedAgentIds(values: readonly string[]): AgentSkillTargetId[] {
  const requested = new Set<AgentSkillTargetId>();
  for (const value of values) {
    const id = resolveAgentSkillTargetId(value);
    if (!id) throw new EmpiricalError("INVALID_ARGUMENT", `Unsupported agent '${value}'`);
    const definition = agentSkillTarget(id);
    if (definition.globalSkillPath === null) {
      throw new EmpiricalError(
        "INVALID_ARGUMENT",
        `Agent '${value}' cannot be installed globally: ${definition.exclusionReason}`,
      );
    }
    requested.add(id);
  }
  return globalAgentSkillTargets()
    .filter((definition) => requested.has(definition.id))
    .map((definition) => definition.id);
}

function groupedGlobalTargets(home: string): Map<string, GlobalAgentSkillTarget[]> {
  const groups = new Map<string, GlobalAgentSkillTarget[]>();
  for (const definition of globalAgentSkillTargets()) {
    const root = agentSkillTargetPath(home, definition);
    const existing = groups.get(root) ?? [];
    existing.push(definition);
    groups.set(root, existing);
  }
  return groups;
}

function globalSelectionPath(home: string): string {
  return join(home, ".empirical-sdd", "integrations.json");
}

async function readGlobalSelection(home: string): Promise<GlobalSelectionRead> {
  const path = globalSelectionPath(home);
  const details = await lstat(path).catch((error) => {
    if (isMissingPathError(error)) return null;
    throw error;
  });
  if (!details) return { selected: null, warning: null, writable: true };
  if (!(await isSafeRegularFile(home, path))) {
    return { selected: null, warning: `${relativeLabel(home, path)} (unsafe or non-file selection metadata)`, writable: false };
  }
  let value: unknown;
  try {
    value = await readJson<unknown>(path);
  } catch {
    return { selected: null, warning: `${relativeLabel(home, path)} (invalid selection metadata)`, writable: false };
  }
  if (!isRecord(value)
    || value.schemaVersion !== GLOBAL_SELECTION_SCHEMA
    || value.managedBy !== GLOBAL_SELECTION_OWNER
    || typeof value.catalogCommit !== "string"
    || !/^[0-9a-f]{40}$/.test(value.catalogCommit)
    || !Array.isArray(value.selected)) {
    return { selected: null, warning: `${relativeLabel(home, path)} (unmanaged or incompatible selection metadata)`, writable: false };
  }
  const selected = resolveManifestSelection(value.selected);
  if (!selected) {
    return { selected: null, warning: `${relativeLabel(home, path)} (invalid selected agent ids)`, writable: false };
  }
  return { selected, warning: null, writable: true };
}

function resolveManifestSelection(values: unknown[]): AgentSkillTargetId[] | null {
  const ids = new Set<AgentSkillTargetId>();
  for (const value of values) {
    if (typeof value !== "string") return null;
    const id = resolveAgentSkillTargetId(value);
    if (!id || id !== value || agentSkillTarget(id).globalSkillPath === null || ids.has(id)) return null;
    ids.add(id);
  }
  return globalAgentSkillTargets().filter((target) => ids.has(target.id)).map((target) => target.id);
}

async function writeGlobalSelection(
  home: string,
  selected: AgentSkillTargetId[],
  report: IntegrationReport,
): Promise<void> {
  const state = await readGlobalSelection(home);
  if (!state.writable) {
    if (state.warning && !report.preserved.includes(state.warning)) report.preserved.push(state.warning);
    return;
  }
  const path = globalSelectionPath(home);
  if (await preserveUnsafeTarget(home, path, report)) return;
  const manifest: GlobalSelectionManifest = {
    schemaVersion: GLOBAL_SELECTION_SCHEMA,
    managedBy: GLOBAL_SELECTION_OWNER,
    catalogCommit: AGENT_CATALOG_SOURCE.commit,
    selected,
  };
  const existed = await isFile(path);
  if (existed) {
    const current = await readFile(path, "utf8");
    const desired = `${JSON.stringify(manifest, null, 2)}\n`;
    if (current === desired) return;
  }
  await writeJsonAtomic(path, manifest);
  (existed ? report.updated : report.created).push(relativeLabel(home, path));
}

async function removeGlobalSelection(
  home: string,
  report: IntegrationReport,
): Promise<void> {
  const state = await readGlobalSelection(home);
  if (!state.writable) {
    if (state.warning && !report.preserved.includes(state.warning)) {
      report.preserved.push(state.warning);
    }
    return;
  }
  if (state.selected === null) return;
  const path = globalSelectionPath(home);
  if (await preserveUnsafeTarget(home, path, report)) return;
  if (!(await isFile(path))) return;
  await rm(path);
  report.removed.push(relativeLabel(home, path));
  await rmdir(dirname(path)).catch((error: NodeJS.ErrnoException) => {
    if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code ?? "")) throw error;
  });
}

async function isSafeRegularFile(root: string, path: string): Promise<boolean> {
  const rootPath = resolve(root);
  const targetPath = resolve(path);
  const label = relativeLabel(rootPath, targetPath);
  if (!label || label === ".." || label.startsWith("../") || isAbsolute(label)) return false;
  const segments = label.split("/");
  let current = rootPath;
  for (let index = 0; index < segments.length; index += 1) {
    current = join(current, segments[index]!);
    const details = await lstat(current).catch(() => null);
    if (!details || details.isSymbolicLink()) return false;
    if (index < segments.length - 1 && !details.isDirectory()) return false;
    if (index === segments.length - 1) return details.isFile();
  }
  return false;
}

function validateHomeRoot(homeRoot: string): string {
  if (!homeRoot.trim()) {
    throw new EmpiricalError("INVALID_ARGUMENT", "Global integration requires a user home directory");
  }
  const home = resolve(homeRoot);
  if (dirname(home) === home) {
    throw new EmpiricalError("INVALID_ARGUMENT", "Global integration refuses a filesystem root as the user home");
  }
  return home;
}

async function writeManagedFile(
  root: string,
  path: string,
  managed: string,
  report: IntegrationReport,
): Promise<void> {
  if (await preserveUnsafeTarget(root, path, report)) return;
  const desired = managed.endsWith("\n") ? managed : `${managed}\n`;
  if (!(await isFile(path))) {
    await writeTextAtomic(path, desired);
    report.created.push(relativeLabel(root, path));
    return;
  }
  const current = await readFile(path, "utf8");
  if (!current.includes(MANAGED_FILE_MARKER)) {
    report.preserved.push(`${relativeLabel(root, path)} (existing unmanaged file)`);
    return;
  }
  if (current !== desired) {
    await writeTextAtomic(path, desired);
    report.updated.push(relativeLabel(root, path));
  }
}

async function removeManagedFile(root: string, path: string, report: IntegrationReport): Promise<void> {
  if (await preserveUnsafeTarget(root, path, report)) return;
  if (!(await isFile(path))) return;
  const current = await readFile(path, "utf8");
  if (!current.includes(MANAGED_FILE_MARKER)) {
    report.preserved.push(`${relativeLabel(root, path)} (existing unmanaged file)`);
    return;
  }
  await rm(path);
  report.removed.push(relativeLabel(root, path));
  await rmdir(dirname(path)).catch((error: NodeJS.ErrnoException) => {
    if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code ?? "")) throw error;
  });
}

async function removeEmptyDirectory(path: string): Promise<void> {
  await rmdir(path).catch((error: NodeJS.ErrnoException) => {
    if (!["ENOENT", "ENOTEMPTY", "EEXIST", "ENOTDIR"].includes(error.code ?? "")) throw error;
  });
}

async function mergeManagedMarkdownBlock(
  root: string,
  path: string,
  managed: string,
  report: IntegrationReport,
): Promise<void> {
  if (await preserveUnsafeTarget(root, path, report)) return;
  if (!(await isFile(path))) {
    await writeTextAtomic(path, `${managed}\n`);
    report.created.push(relativeLabel(root, path));
    return;
  }
  const current = await readFile(path, "utf8");
  const starts = markerIndexes(current, START);
  const ends = markerIndexes(current, END);
  if (starts.length === 1 && ends.length === 1 && ends[0]! >= starts[0]!) {
    const next = `${current.slice(0, starts[0]!)}${managed}${current.slice(ends[0]! + END.length)}`;
    if (next !== current) {
      await writeTextAtomic(path, next);
      report.updated.push(relativeLabel(root, path));
    }
    return;
  }
  if (starts.length > 0 || ends.length > 0) {
    report.preserved.push(`${relativeLabel(root, path)} (unmatched Empirical marker)`);
    return;
  }
  const separator = current.endsWith("\n") ? "\n" : "\n\n";
  await writeTextAtomic(path, `${current}${separator}${managed}\n`);
  report.updated.push(relativeLabel(root, path));
}

async function mergeMcpJson(
  root: string,
  path: string,
  report: IntegrationReport,
  extra: Record<string, unknown> = {},
): Promise<void> {
  if (await preserveUnsafeTarget(root, path, report)) return;
  let document: Record<string, unknown> = {};
  const existed = await isFile(path);
  if (existed) {
    try {
      document = await readJson<Record<string, unknown>>(path);
    } catch {
      report.preserved.push(`${relativeLabel(root, path)} (invalid JSON)`);
      return;
    }
  }
  if (document.mcpServers !== undefined && !isRecord(document.mcpServers)) {
    report.preserved.push(`${relativeLabel(root, path)} (invalid mcpServers value)`);
    return;
  }
  const servers = isRecord(document.mcpServers) ? document.mcpServers : {};
  const existing = servers.empirical;
  const desired = { ...MCP_SERVER, ...extra };
  if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(desired)) {
    report.preserved.push(`${relativeLabel(root, path)} (existing empirical MCP entry)`);
    return;
  }
  if (existing !== undefined) return;
  document.mcpServers = { ...servers, empirical: desired };
  await writeJsonAtomic(path, document);
  (existed ? report.updated : report.created).push(relativeLabel(root, path));
}

async function mergeCodexToml(root: string, path: string, report: IntegrationReport): Promise<void> {
  if (await preserveUnsafeTarget(root, path, report)) return;
  if (!(await isFile(path))) {
    await writeTextAtomic(path, `${CODEX_MCP_BLOCK}\n`);
    report.created.push(relativeLabel(root, path));
    return;
  }
  const current = await readFile(path, "utf8");
  const starts = markerIndexes(current, CODEX_MCP_START);
  const ends = markerIndexes(current, CODEX_MCP_END);
  if (starts.length === 1 && ends.length === 1 && ends[0]! >= starts[0]!) {
    const next = `${current.slice(0, starts[0]!)}${CODEX_MCP_BLOCK}${current.slice(ends[0]! + CODEX_MCP_END.length)}`;
    if (next !== current) {
      await writeTextAtomic(path, next);
      report.updated.push(relativeLabel(root, path));
    }
    return;
  }
  if (starts.length > 0 || ends.length > 0) {
    report.preserved.push(`${relativeLabel(root, path)} (unmatched Empirical marker)`);
    return;
  }
  if (/^\s*\[mcp_servers\.empirical\]\s*$/m.test(current)) {
    report.preserved.push(`${relativeLabel(root, path)} (existing empirical MCP table)`);
    return;
  }
  const separator = current.endsWith("\n") ? "\n" : "\n\n";
  await writeTextAtomic(path, `${current}${separator}${CODEX_MCP_BLOCK}\n`);
  report.updated.push(relativeLabel(root, path));
}

type ProjectIntegrationTargetState = "ready" | "missing" | "drifted";

async function inspectProjectIntegrationTarget(
  root: string,
  label: string,
  inspect: (contents: string) => boolean,
): Promise<ProjectIntegrationTargetState> {
  const target = join(root, ...label.split("/"));
  const segments = label.split("/");
  let current = root;
  for (let index = 0; index < segments.length; index += 1) {
    current = join(current, segments[index]!);
    const details = await lstat(current).catch((error) => {
      if (isMissingPathError(error)) return null;
      throw error;
    });
    if (!details) return "missing";
    if (details.isSymbolicLink()) return "drifted";
    if (index < segments.length - 1 && !details.isDirectory()) return "drifted";
    if (index === segments.length - 1 && !details.isFile()) return "drifted";
  }
  return inspect(await readFile(target, "utf8")) ? "ready" : "drifted";
}

function hasExactManagedBlock(
  contents: string,
  start: string,
  end: string,
  expected: string,
): boolean {
  const starts = markerIndexes(contents, start);
  const ends = markerIndexes(contents, end);
  return starts.length === 1
    && ends.length === 1
    && ends[0]! >= starts[0]!
    && contents.slice(starts[0]!, ends[0]! + end.length) === expected;
}

function hasExactMcpEntry(contents: string, extra: Record<string, unknown> = {}): boolean {
  let document: unknown;
  try {
    document = JSON.parse(contents) as unknown;
  } catch {
    return false;
  }
  if (!isRecord(document) || !isRecord(document.mcpServers)) return false;
  return JSON.stringify(document.mcpServers.empirical)
    === JSON.stringify({ ...MCP_SERVER, ...extra });
}

async function preserveUnsafeTarget(
  root: string,
  path: string,
  report: IntegrationReport,
): Promise<boolean> {
  const rootPath = resolve(root);
  const targetPath = resolve(path);
  const label = relativeLabel(rootPath, targetPath);
  if (!label || label === ".." || label.startsWith("../") || isAbsolute(label)) {
    throw new EmpiricalError("INVALID_ARGUMENT", `Integration target escapes its root: ${path}`);
  }

  const segments = label.split("/");
  let current = rootPath;
  for (let index = 0; index < segments.length; index += 1) {
    current = join(current, segments[index]!);
    let details;
    try {
      details = await lstat(current);
    } catch (error) {
      if (isMissingPathError(error)) return false;
      throw error;
    }
    if (details.isSymbolicLink()) {
      const suffix = index === segments.length - 1
        ? "symbolic link"
        : `symbolic link ancestor ${relativeLabel(rootPath, current)}`;
      report.preserved.push(`${label} (${suffix})`);
      return true;
    }
    if (index < segments.length - 1 && !details.isDirectory()) {
      report.preserved.push(`${label} (non-directory ancestor ${relativeLabel(rootPath, current)})`);
      return true;
    }
    if (index === segments.length - 1 && !details.isFile()) {
      report.preserved.push(`${label} (existing non-file)`);
      return true;
    }
  }
  return false;
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function markerIndexes(contents: string, marker: string): number[] {
  const indexes: number[] = [];
  let offset = 0;
  while (offset < contents.length) {
    const index = contents.indexOf(marker, offset);
    if (index < 0) break;
    indexes.push(index);
    offset = index + marker.length;
  }
  return indexes;
}

function relativeLabel(root: string, path: string): string {
  return relative(root, path).replaceAll("\\", "/");
}
