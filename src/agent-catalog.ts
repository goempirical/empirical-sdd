import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

export const AGENT_CATALOG_SOURCE = {
  repository: "https://github.com/vercel-labs/skills",
  version: "1.5.21",
  commit: "7cb7db64dc1201052dea305e508a2fc490f7e5e2",
} as const;

export interface AgentSkillTargetDefinition {
  id: string;
  label: string;
  globalSkillPath: string | null;
  detectPaths: readonly string[];
  aliases?: readonly string[];
  executables?: readonly string[];
  invocation?: string;
  reload?: string;
  projectMcp?: boolean;
  handoff?: boolean;
  exclusionReason?: string;
}

const skillOnly = <
  const Id extends string,
  const Label extends string,
  const GlobalSkillPath extends string,
  const DetectPaths extends readonly string[],
>(
  id: Id,
  label: Label,
  globalSkillPath: GlobalSkillPath,
  detectPaths: DetectPaths,
) => ({ id, label, globalSkillPath, detectPaths } as const);

export const AGENT_SKILL_TARGETS = [
  skillOnly("aider-desk", "AiderDesk", ".aider-desk/skills", [".aider-desk"]),
  skillOnly("amp", "Amp", ".config/agents/skills", [".config/amp"]),
  skillOnly("antigravity", "Antigravity", ".gemini/antigravity/skills", [".gemini/antigravity"]),
  skillOnly("antigravity-cli", "Antigravity CLI", ".gemini/antigravity-cli/skills", [".gemini/antigravity-cli"]),
  skillOnly("astrbot", "AstrBot", ".astrbot/data/skills", [".astrbot"]),
  skillOnly("autohand-code", "Autohand Code CLI", ".autohand/skills", [".autohand"]),
  skillOnly("augment", "Augment", ".augment/skills", [".augment"]),
  skillOnly("bob", "IBM Bob", ".bob/skills", [".bob"]),
  {
    id: "claude-code",
    label: "Claude Code",
    globalSkillPath: ".claude/skills",
    detectPaths: [".claude"],
    aliases: ["claude"],
    executables: ["claude"],
    invocation: "/empirical",
    reload: "Restart Claude Code so it reloads the global Empirical Init skill, then invoke /empirical-init for repository setup or repair.",
    projectMcp: true,
    handoff: true,
  },
  skillOnly("openclaw", "OpenClaw", ".openclaw/skills", [".openclaw", ".clawdbot", ".moltbot"]),
  skillOnly("cline", "Cline", ".agents/skills", [".cline"]),
  skillOnly("codearts-agent", "CodeArts Agent", ".codeartsdoer/skills", [".codeartsdoer"]),
  skillOnly("codebuddy", "CodeBuddy", ".codebuddy/skills", [".codebuddy"]),
  skillOnly("codemaker", "Codemaker", ".codemaker/skills", [".codemaker"]),
  skillOnly("codestudio", "Code Studio", ".codestudio/skills", [".codestudio"]),
  {
    id: "codex",
    label: "Codex",
    globalSkillPath: ".codex/skills",
    detectPaths: [".codex"],
    executables: ["codex"],
    invocation: "$empirical",
    reload: "Restart or reopen Codex so it rescans user skills, then invoke $empirical-init for repository setup or repair.",
    projectMcp: true,
    handoff: true,
  },
  skillOnly("command-code", "Command Code", ".commandcode/skills", [".commandcode"]),
  skillOnly("continue", "Continue", ".continue/skills", [".continue"]),
  skillOnly("cortex", "Cortex Code", ".snowflake/cortex/skills", [".snowflake/cortex"]),
  skillOnly("crush", "Crush", ".config/crush/skills", [".config/crush"]),
  {
    id: "cursor",
    label: "Cursor",
    globalSkillPath: ".cursor/skills",
    detectPaths: [".cursor"],
    executables: ["cursor"],
    invocation: "empirical",
    reload: "Reload Cursor and open Agent chat; Cursor discovers the global Empirical skills.",
    projectMcp: true,
    handoff: true,
  },
  skillOnly("deepagents", "Deep Agents", ".deepagents/agent/skills", [".deepagents"]),
  skillOnly("devin", "Devin for Terminal", ".config/devin/skills", [".config/devin"]),
  skillOnly("dexto", "Dexto", ".agents/skills", [".dexto"]),
  skillOnly("droid", "Droid", ".factory/skills", [".factory"]),
  {
    id: "eve",
    label: "Eve",
    globalSkillPath: null,
    detectPaths: [],
    exclusionReason: "Eve supports project-local skills only.",
  },
  skillOnly("firebender", "Firebender", ".firebender/skills", [".firebender"]),
  skillOnly("forgecode", "ForgeCode", ".forge/skills", [".forge"]),
  {
    id: "gemini-cli",
    label: "Gemini CLI",
    globalSkillPath: ".gemini/skills",
    detectPaths: [".gemini"],
    aliases: ["gemini"],
    executables: ["gemini"],
    invocation: "empirical",
    reload: "Run /skills reload and /skills list, then ask Gemini to run the desired Empirical skill.",
    projectMcp: true,
    handoff: true,
  },
  skillOnly("github-copilot", "GitHub Copilot", ".copilot/skills", [".copilot"]),
  skillOnly("goose", "Goose", ".config/goose/skills", [".config/goose"]),
  skillOnly("grok", "Grok Build", ".grok/skills", [".grok"]),
  skillOnly("hermes-agent", "Hermes Agent", ".hermes/skills", [".hermes"]),
  skillOnly("inference-sh", "inference.sh", ".inferencesh/skills", [".inferencesh"]),
  skillOnly("jazz", "Jazz", ".jazz/skills", [".jazz"]),
  skillOnly("junie", "Junie", ".junie/skills", [".junie"]),
  skillOnly("iflow-cli", "iFlow CLI", ".iflow/skills", [".iflow"]),
  skillOnly("kilo", "Kilo Code", ".kilocode/skills", [".kilocode"]),
  skillOnly("kimchi", "Kimchi", ".config/kimchi/harness/skills", [".config/kimchi"]),
  skillOnly("kimi-code-cli", "Kimi Code CLI", ".agents/skills", [".kimi-code", ".kimi"]),
  skillOnly("kiro-cli", "Kiro CLI", ".kiro/skills", [".kiro"]),
  skillOnly("kode", "Kode", ".kode/skills", [".kode"]),
  skillOnly("lingma", "Lingma", ".lingma/skills", [".lingma"]),
  skillOnly("loaf", "Loaf", ".agents/skills", [".loaf"]),
  skillOnly("mcpjam", "MCPJam", ".mcpjam/skills", [".mcpjam"]),
  skillOnly("mistral-vibe", "Mistral Vibe", ".vibe/skills", [".vibe"]),
  skillOnly("moxby", "Moxby", ".moxby/skills", [".moxby"]),
  skillOnly("mux", "Mux", ".mux/skills", [".mux"]),
  skillOnly("opencode", "OpenCode", ".config/opencode/skills", [".config/opencode"]),
  skillOnly("openhands", "OpenHands", ".openhands/skills", [".openhands"]),
  skillOnly("ona", "Ona", ".ona/skills", [".ona"]),
  skillOnly("pi", "Pi", ".pi/agent/skills", [".pi/agent"]),
  skillOnly("qoder", "Qoder", ".qoder/skills", [".qoder"]),
  skillOnly("qoder-cn", "Qoder CN", ".qoder-cn/skills", [".qoder-cn"]),
  skillOnly("qwen-code", "Qwen Code", ".qwen/skills", [".qwen"]),
  skillOnly("replit", "Replit", ".config/agents/skills", []),
  skillOnly("reasonix", "Reasonix", ".reasonix/skills", [".reasonix"]),
  skillOnly("rovodev", "Rovo Dev", ".rovodev/skills", [".rovodev"]),
  skillOnly("roo", "Roo Code", ".roo/skills", [".roo"]),
  skillOnly("tabnine-cli", "Tabnine CLI", ".tabnine/agent/skills", [".tabnine"]),
  skillOnly("terramind", "Terramind", ".terramind/skills", [".terramind"]),
  skillOnly("tinycloud", "Tinycloud", ".tinycloud/skills", [".tinycloud"]),
  skillOnly("trae", "Trae", ".trae/skills", [".trae"]),
  skillOnly("trae-cn", "Trae CN", ".trae-cn/skills", [".trae-cn"]),
  skillOnly("warp", "Warp", ".agents/skills", [".warp"]),
  {
    id: "windsurf",
    label: "Windsurf",
    globalSkillPath: ".codeium/windsurf/skills",
    detectPaths: [".codeium/windsurf"],
    executables: ["windsurf"],
    invocation: "@empirical",
    reload: "Reload Windsurf or start a new Cascade session, then invoke @empirical-init for repository setup or repair.",
    projectMcp: true,
    handoff: true,
  },
  skillOnly("zed", "Zed", ".agents/skills", [".config/zed"]),
  skillOnly("zcode", "ZCode", ".zcode/skills", [".zcode"]),
  skillOnly("zencoder", "Zencoder", ".zencoder/skills", [".zencoder"]),
  skillOnly("zenflow", "Zenflow", ".zencoder/skills", [".zencoder"]),
  skillOnly("neovate", "Neovate", ".neovate/skills", [".neovate"]),
  skillOnly("pochi", "Pochi", ".pochi/skills", [".pochi"]),
  {
    id: "promptscript",
    label: "PromptScript",
    globalSkillPath: null,
    detectPaths: [],
    exclusionReason: "PromptScript supports project-local skills only.",
  },
  skillOnly("adal", "AdaL", ".adal/skills", [".adal"]),
  skillOnly("universal", "Universal", ".config/agents/skills", []),
] as const;

export type AgentSkillTargetId = typeof AGENT_SKILL_TARGETS[number]["id"];
export type AgentSkillTarget = typeof AGENT_SKILL_TARGETS[number];
export type GlobalAgentSkillTarget = AgentSkillTargetDefinition & {
  id: AgentSkillTargetId;
  globalSkillPath: string;
};

export interface AgentSkillDetectionOptions {
  homeRoot: string;
  pathValue?: string;
}

export function globalAgentSkillTargets(): GlobalAgentSkillTarget[] {
  return AGENT_SKILL_TARGETS
    .filter((target) => target.globalSkillPath !== null)
    .map((target) => target as GlobalAgentSkillTarget);
}

export function agentSkillTarget(id: AgentSkillTargetId): AgentSkillTargetDefinition & { id: AgentSkillTargetId } {
  const target = AGENT_SKILL_TARGETS.find((candidate) => candidate.id === id);
  if (!target) throw new Error(`Unknown agent skill target ${id}`);
  return target as AgentSkillTargetDefinition & { id: AgentSkillTargetId };
}

export function resolveAgentSkillTargetId(value: string): AgentSkillTargetId | null {
  const normalized = value.trim().toLowerCase();
  const target = AGENT_SKILL_TARGETS.find((candidate) => (
    candidate.id === normalized
      || (candidate as AgentSkillTargetDefinition).aliases?.includes(normalized)
  ));
  return target?.id ?? null;
}

export function agentSkillTargetPath(homeRoot: string, target: GlobalAgentSkillTarget): string {
  return join(homeRoot, ...target.globalSkillPath.split("/"));
}

export async function detectAgentSkillTargets(
  options: AgentSkillDetectionOptions,
): Promise<AgentSkillTargetId[]> {
  const detected: AgentSkillTargetId[] = [];
  const pathValue = options.pathValue ?? process.env.PATH ?? "";
  for (const target of globalAgentSkillTargets()) {
    const executable = target.executables?.length
      ? await findExecutable(target.executables, pathValue)
      : false;
    const configured = await anyDirectory(options.homeRoot, target.detectPaths);
    if (executable || configured) detected.push(target.id);
  }
  return detected;
}

export function validateAgentSkillCatalog(): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const target of AGENT_SKILL_TARGETS) {
    const definition = target as AgentSkillTargetDefinition;
    if (!target.label.trim()) issues.push(`${target.id} needs a display label`);
    if (ids.has(target.id)) issues.push(`Duplicate agent id '${target.id}'`);
    ids.add(target.id);
    for (const name of [target.id, ...((target as AgentSkillTargetDefinition).aliases ?? [])]) {
      if (name !== name.trim().toLowerCase() || !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
        issues.push(`Invalid agent id or alias '${name}'`);
      }
      if (names.has(name)) issues.push(`Duplicate agent id or alias '${name}'`);
      names.add(name);
    }
    if (target.globalSkillPath === null) {
      if (!target.exclusionReason?.trim()) issues.push(`${target.id} needs an exclusion reason`);
      continue;
    }
    if (!safeRelativePath(target.globalSkillPath)) {
      issues.push(`${target.id} has unsafe global path '${target.globalSkillPath}'`);
    }
    for (const path of target.detectPaths) {
      if (!safeRelativePath(path)) issues.push(`${target.id} has unsafe detection path '${path}'`);
    }
    if (definition.invocation && !definition.reload) issues.push(`${target.id} has invocation without reload guidance`);
  }
  if (AGENT_SKILL_TARGETS.length !== 75) issues.push(`Expected 75 pinned targets, found ${AGENT_SKILL_TARGETS.length}`);
  if (globalAgentSkillTargets().length !== 73) issues.push(`Expected 73 global targets, found ${globalAgentSkillTargets().length}`);
  return issues;
}

function safeRelativePath(value: string): boolean {
  if (!value || isAbsolute(value) || /[\0\r\n]/.test(value)) return false;
  const segments = value.replaceAll("\\", "/").split("/");
  return segments.every((segment) => Boolean(segment) && segment !== "." && segment !== "..");
}

async function anyDirectory(homeRoot: string, paths: readonly string[]): Promise<boolean> {
  for (const path of paths) {
    const details = await stat(join(homeRoot, ...path.split("/"))).catch(() => null);
    if (details?.isDirectory()) return true;
  }
  return false;
}

async function findExecutable(candidates: readonly string[], pathValue: string): Promise<boolean> {
  const extensions = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
    : [""];
  for (const directory of pathValue.split(delimiter).filter(Boolean)) {
    for (const candidate of candidates) {
      for (const extension of extensions) {
        if (await access(join(directory, `${candidate}${extension}`), process.platform === "win32" ? constants.F_OK : constants.X_OK)
          .then(() => true, () => false)) return true;
      }
    }
  }
  return false;
}
