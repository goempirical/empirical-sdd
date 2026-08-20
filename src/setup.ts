import { EmpiricalError } from "./errors.js";
import {
  defaultTrackerSecretFilePath,
  trackerAuthenticationGuidance,
  trackerCredentialNames,
} from "./tracker-auth.js";
import type { TrackerSetupState } from "./tracking.js";
import type { ProjectConfig, ProjectConfigurationInput, TrackerPolicy } from "./types.js";

export type SetupSettings = Pick<ProjectConfig, "evidence" | "isolation" | "decisions" | "interaction">;

export function recommendedSetupSettings(): SetupSettings {
  return {
    evidence: {
      required: true,
      browserForUi: true,
      screenshotForUi: true,
      codeReview: true,
    },
    isolation: {
      mode: "ask",
      baseBranch: "auto",
      worktreePath: "../{repo}-{feature}",
      branchPattern: "{type}/{feature}",
    },
    decisions: { complexRecords: "required" },
    interaction: { questions: "concise" },
  };
}

export function setupSettingsFromConfig(config: ProjectConfig): SetupSettings {
  return {
    evidence: { ...config.evidence },
    isolation: { ...config.isolation },
    decisions: { ...config.decisions },
    interaction: { ...config.interaction },
  };
}

export function setupConfigurationInput(settings: SetupSettings): ProjectConfigurationInput {
  return {
    evidence: { ...settings.evidence },
    isolation: { ...settings.isolation },
    decisions: { ...settings.decisions },
    interaction: { ...settings.interaction },
    setupComplete: true,
  };
}

export function validateSetupSettings(settings: SetupSettings): void {
  if (settings.isolation.mode !== "ask" && settings.isolation.mode !== "off") {
    throw new EmpiricalError("INVALID_CONFIG", "Isolation must be ask or off");
  }
  if (!settings.isolation.baseBranch.trim()) {
    throw new EmpiricalError("INVALID_CONFIG", "Default Git base must not be empty");
  }
  validateTemplate(
    settings.isolation.worktreePath,
    ["feature"],
    "Worktree path template must contain {feature}",
  );
  validateTemplate(
    settings.isolation.branchPattern,
    ["type", "feature"],
    "Branch pattern must contain {type} and {feature}",
  );
  if (settings.decisions.complexRecords !== "required" && settings.decisions.complexRecords !== "off") {
    throw new EmpiricalError("INVALID_CONFIG", "Complex decisions must be required or off");
  }
  if (settings.interaction.questions !== "concise" && settings.interaction.questions !== "detailed") {
    throw new EmpiricalError("INVALID_CONFIG", "Questions must be concise or detailed");
  }
}

export function renderSetupSummary(
  settings: SetupSettings,
  options: {
    current: boolean;
    effective?: boolean;
    resolvedBase?: string;
    tracker?: TrackerPolicy | null;
    trackerSetup?: TrackerSetupState;
  } = { current: false },
): string {
  const state = options.effective ? "effective" : options.current ? "current" : "recommended";
  const base = settings.isolation.baseBranch === "auto" && options.resolvedBase
    ? `auto (currently ${options.resolvedBase})`
    : settings.isolation.baseBranch;
  const inactive = settings.evidence.required ? "" : " · inactive";
  const trackerSetup = options.trackerSetup ?? ("tracker" in options
    ? options.tracker
      ? { mode: "configured", policy: options.tracker } as const
      : { mode: "disabled", policy: null } as const
    : { mode: "unconfigured", policy: null } as const);
  const trackerGuidance = trackerSetup.mode === "configured"
    ? trackerAuthenticationGuidance(trackerSetup.policy)
    : null;
  if (settings.interaction.questions === "concise") {
    const verification = [
      `tests ${onOff(settings.evidence.required)}`,
      `browser ${onOff(settings.evidence.browserForUi)}`,
      `screenshots ${onOff(settings.evidence.screenshotForUi)}`,
      `review ${onOff(settings.evidence.codeReview)}`,
    ].join(" · ");
    const tracker = trackerSetup.mode === "configured"
      ? [
          `Tracker: ${trackerSelectionLabel(trackerSetup.policy)} · ${state}`,
          `Auth: host OAuth first · fallback ${trackerGuidance!.secretFilePath} · Never paste credentials into chat`,
        ]
      : trackerSetup.mode === "disabled"
        ? [`Tracker: no tracking · local-only · ${state}`]
        : [
            `Tracker: choose Track work or No tracking before Save · ${state}`,
            `Auth: host OAuth first · fallback ${defaultTrackerSecretFilePath()} · Never paste credentials into chat`,
          ];
    return [
      `◆ Empirical setup · ${state}`,
      "Questions: concise · only material blockers",
      `Verification: ${verification}`,
      `Worktrees: ${settings.isolation.mode} · base ${base} · ${settings.isolation.branchPattern}`,
      `Decisions: ${settings.decisions.complexRecords}`,
      ...tracker,
    ].join("\n");
  }
  return [
    "◆ Empirical setup",
    `│  ${options.effective ? "Effective settings" : options.current ? "Current settings" : "Recommended settings"}`,
    "│",
    "│  Verification",
    `│  ${marker(settings.evidence.required)} Acceptance-test evidence for every criterion  ${onOff(settings.evidence.required)} · ${state}`,
    `│  ${marker(settings.evidence.browserForUi)} Real-browser evidence for [UI] criteria  ${onOff(settings.evidence.browserForUi)}${inactive}`,
    `│  ${marker(settings.evidence.screenshotForUi)} Screenshot artifact for [UI] criteria  ${onOff(settings.evidence.screenshotForUi)}${inactive}`,
    `│  ${marker(settings.evidence.codeReview)} Independent code-review evidence  ${onOff(settings.evidence.codeReview)}`,
    ...(settings.evidence.required ? [] : [
      "│  Browser and screenshot values stay saved but do not gate criteria while acceptance-test evidence is off.",
      "│  Code review remains independent.",
    ]),
    "│",
    "│  Parallel work",
    `│  ${marker(settings.isolation.mode === "ask")} ${settings.isolation.mode === "ask" ? "Ask before creating an isolated worktree" : "Do not offer isolated worktrees"}`,
    `│    Base: ${base}`,
    `│    Path: ${settings.isolation.worktreePath}`,
    `│    Branch: ${settings.isolation.branchPattern}`,
    "│",
    "│  Decisions",
    `│  ${marker(settings.decisions.complexRecords === "required")} ${settings.decisions.complexRecords === "required" ? "Require reviewable decision records for Complex work" : "Do not require Complex decision records"}`,
    "│",
    "│  Interaction",
    "│  ● Detailed questions and expanded runtime summaries",
    "│",
    "│  Tracker",
    ...(trackerSetup.mode === "configured" ? [
      `│  ● ${trackerSelectionLabel(trackerSetup.policy)} · ${state}`,
      "│    Authentication: trusted host OAuth preferred",
      `│    Fallback file: ${trackerGuidance!.secretFilePath}`,
      `│    Credential source: ${trackerCredentialNames(trackerSetup.policy).join(", ")} (environment names only)`,
      `│    ${trackerGuidance!.warning}.`,
    ] : trackerSetup.mode === "disabled" ? [
      `│  ● No tracking (local-only; no provider requests) · ${state}`,
    ] : [
      `│  ● Track all work (recommended; configure a provider before Save) · ${state}`,
      "│  ○ No tracking (local-only; no provider requests)",
      "│    Authentication: trusted host OAuth preferred for Linear, GitHub, and Jira.",
      `│    Host-only fallback file: ${defaultTrackerSecretFilePath()}`,
      "│    Never paste credentials into chat.",
      "│    Choose one tracker mode before setup can be saved.",
    ]),
  ].join("\n");
}

function trackerSelectionLabel(policy: TrackerPolicy): string {
  const selection = policy.schemaVersion === 2 && policy.ticketRules
    ? "Track by work type"
    : policy.schemaVersion === 2 && policy.ticket === "ensure"
      ? "Track all work"
    : "Tracker configured";
  return `${selection} · ${trackerLabel(policy)}`;
}

function trackerLabel(policy: TrackerPolicy): string {
  if (policy.schemaVersion === 1) return `${providerLabel(policy.provider)} · Policy v1 manual/legacy`;
  return `${providerLabel(policy.provider)} · tickets ${policy.ticket} · progress ${policy.visibility}`;
}

function providerLabel(provider: TrackerPolicy["provider"]): string {
  return provider === "github" ? "GitHub Projects" : provider === "linear" ? "Linear" : "Jira";
}

function marker(enabled: boolean): string {
  return enabled ? "●" : "○";
}

function onOff(enabled: boolean): "on" | "off" {
  return enabled ? "on" : "off";
}

function validateTemplate(value: string, required: string[], missingMessage: string): void {
  if (!value.trim() || required.some((placeholder) => !value.includes(`{${placeholder}}`))) {
    throw new EmpiricalError("INVALID_CONFIG", missingMessage);
  }
  const allowed = value
    .replaceAll("{repo}", "")
    .replaceAll("{feature}", "")
    .replaceAll("{type}", "");
  if (/[\0\r\n]/.test(value) || /[{}]/.test(allowed)) {
    throw new EmpiricalError("INVALID_CONFIG", "Worktree templates contain unsupported placeholders or control characters");
  }
}
