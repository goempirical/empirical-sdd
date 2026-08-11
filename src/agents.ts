import { createHash } from "node:crypto";
import { access, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { constants } from "node:fs";
import type {
  AgentHandoffOption,
  AgentIntegrationId,
  AgentLaunchCapability,
  DetectedAgent,
} from "./types.js";

export interface SupportedAgentDefinition {
  id: AgentIntegrationId;
  agent: string;
  executables: string[];
  skillSegments: string[];
  invocation: string;
  reload: string;
  capability: AgentLaunchCapability;
}

export const SUPPORTED_AGENTS: SupportedAgentDefinition[] = [
  {
    id: "codex",
    agent: "Codex",
    executables: ["codex"],
    skillSegments: [".codex", "skills"],
    invocation: "$empirical",
    reload: "Restart or reopen Codex so it rescans user skills, then invoke $empirical-init for repository setup or repair.",
    capability: "prompt",
  },
  {
    id: "claude",
    agent: "Claude Code",
    executables: ["claude"],
    skillSegments: [".claude", "skills"],
    invocation: "/empirical",
    reload: "Restart Claude Code so it reloads the global Empirical Init skill, then invoke /empirical-init for repository setup or repair.",
    capability: "prompt",
  },
  {
    id: "cursor",
    agent: "Cursor",
    executables: ["cursor"],
    skillSegments: [".cursor", "skills"],
    invocation: "empirical",
    reload: "Reload Cursor and open Agent chat; Cursor discovers the global Empirical skills.",
    capability: "workspace",
  },
  {
    id: "gemini",
    agent: "Gemini CLI",
    executables: ["gemini"],
    skillSegments: [".gemini", "skills"],
    invocation: "empirical",
    reload: "Run /skills reload and /skills list, then ask Gemini to run the desired Empirical skill.",
    capability: "prompt",
  },
  {
    id: "windsurf",
    agent: "Windsurf",
    executables: ["windsurf"],
    skillSegments: [".codeium", "windsurf", "skills"],
    invocation: "@empirical",
    reload: "Reload Windsurf or start a new Cascade session, then invoke @empirical-init for repository setup or repair.",
    capability: "workspace",
  },
];

export interface AgentDetectionOptions {
  homeRoot?: string;
  pathValue?: string;
  includeAll?: boolean;
  includeConfigured?: boolean;
}

export async function detectSupportedAgents(
  options: AgentDetectionOptions = {},
): Promise<DetectedAgent[]> {
  const home = resolve(options.homeRoot ?? homedir());
  const pathValue = options.pathValue ?? process.env.PATH ?? "";
  const detected: DetectedAgent[] = [];
  for (const definition of SUPPORTED_AGENTS) {
    const executable = await findExecutable(definition.executables, pathValue);
    const configured = options.includeConfigured !== false
      && await isDirectory(join(home, ...definition.skillSegments.slice(0, -1)));
    if (!options.includeAll && !executable && !configured) continue;
    detected.push({
      id: definition.id,
      agent: definition.agent,
      executable: executable ?? definition.executables[0]!,
      capability: definition.capability,
    });
  }
  return detected;
}

export function agentDefinition(id: AgentIntegrationId): SupportedAgentDefinition {
  const definition = SUPPORTED_AGENTS.find((candidate) => candidate.id === id);
  if (!definition) throw new Error(`Unsupported agent ${id}`);
  return definition;
}

export function buildHandoffOption(input: {
  root: string;
  feature: string;
  specification: string;
  specDigest: string;
  agent: DetectedAgent;
}): AgentHandoffOption {
  const cwd = resolve(input.root);
  const specification = resolve(input.specification);
  const prompt = [
    `Resume the active Empirical feature ${input.feature} in ${cwd}.`,
    `Treat ${specification} as the approved specification.`,
    "Run the current Empirical action, complete exact revisions with required evidence, archive reviewed capability deltas, and continue until Done, Blocked, or genuinely awaiting human input.",
  ].join(" ");
  const argv = input.agent.capability === "prompt"
    ? [input.agent.executable, prompt]
    : [input.agent.executable, cwd];
  const approvalToken = handoffToken({
    agent: input.agent.id,
    capability: input.agent.capability,
    cwd,
    feature: input.feature,
    specification,
    specDigest: input.specDigest,
    prompt,
    argv,
  });
  return {
    ...input.agent,
    feature: input.feature,
    specification,
    cwd,
    prompt,
    argv,
    approvalToken,
  };
}

export function handoffToken(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function findExecutable(candidates: string[], pathValue: string): Promise<string | null> {
  const extensions = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
    : [""];
  for (const candidate of candidates) {
    if (isAbsolute(candidate) && await isExecutable(candidate)) return candidate;
    for (const directory of pathValue.split(delimiter).filter(Boolean)) {
      for (const extension of extensions) {
        const path = join(directory, `${candidate}${extension}`);
        if (await isExecutable(path)) return path;
      }
    }
  }
  return null;
}

async function isExecutable(path: string): Promise<boolean> {
  return access(path, process.platform === "win32" ? constants.F_OK : constants.X_OK)
    .then(() => true, () => false);
}

async function isDirectory(path: string): Promise<boolean> {
  return stat(path).then((details) => details.isDirectory(), () => false);
}
