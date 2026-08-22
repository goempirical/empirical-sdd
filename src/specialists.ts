import type { RiskFloor } from "./protocol.js";
import type { Criterion, Phase } from "./types.js";

const RISK_ORDER: readonly RiskFloor[] = [
  "contract-neutral",
  "behavioral",
  "sensitive",
  "migration",
  "integration",
  "delivery",
  "publication",
] as const;

export type ConsultVerdict = "advisory" | "blocking";
export type FindingSeverity = "critical" | "high" | "medium" | "low";

const SEVERITIES: readonly FindingSeverity[] = ["critical", "high", "medium", "low"] as const;
const VERDICTS: readonly ConsultVerdict[] = ["advisory", "blocking"] as const;
const BLOCKING_SEVERITIES: readonly FindingSeverity[] = ["critical", "high"] as const;

export interface SpecialistDefinition {
  /** Stable slug used in paths, packets, and advisories. */
  id: string;
  title: string;
  /** What this specialist is for. Rendered into the consult packet. */
  charter: string;
  /** The single question the consult must answer. */
  question: string;
  /** Lowest risk floor that requires this specialist, or null when never triggered by risk. */
  riskFloor: RiskFloor | null;
  /** When true, any [UI] acceptance criterion requires this specialist. */
  uiSurface: boolean;
  /** Feature-relative paths this specialist may read. Kept strictly narrower than a phase packet. */
  contextSlice: readonly string[];
  /** Phases whose gate this specialist's advisory is required at. */
  gatePhases: readonly Phase[];
  /** Finding categories in which this specialist may block. */
  domain: readonly string[];
}

function specialist(definition: SpecialistDefinition): SpecialistDefinition {
  return Object.freeze({
    ...definition,
    contextSlice: Object.freeze([...definition.contextSlice]),
    gatePhases: Object.freeze([...definition.gatePhases]),
    domain: Object.freeze([...definition.domain]),
  });
}

export const SPECIALISTS = Object.freeze([
  specialist({
    id: "security",
    title: "Security",
    charter:
      "Adversarially review this change. Do not confirm that it works; try to break it. Threat-model the new entry points, trust boundaries, and paths from untrusted input to a dangerous sink. Verify a guard's response, not merely its presence: a limit that drops the connection or throws instead of refusing cleanly is still a defect.",
    question:
      "How does this change get exploited, and what is the smallest fix that closes it?",
    riskFloor: "sensitive",
    uiSurface: false,
    contextSlice: ["spec.md", "design.md", "deltas"],
    gatePhases: ["verify"],
    domain: [
      "injection",
      "authentication",
      "authorization",
      "secrets",
      "untrusted-input",
      "unsafe-execution",
    ],
  }),
  specialist({
    id: "ui-ux",
    title: "UI/UX design",
    charter:
      "Review the interface this change produces before it is built. Ground the review in the repository's existing conventions and tokens rather than inventing a new visual language, and state what is deliberately ruled out.",
    question:
      "Is this the clearest interface for the stated criteria, and what should it look like concretely?",
    riskFloor: null,
    uiSurface: true,
    contextSlice: ["spec.md", "design.md"],
    gatePhases: ["design"],
    domain: ["layout", "interaction", "state-coverage", "visual-consistency"],
  }),
] satisfies SpecialistDefinition[]);

const KNOWN_PHASES: ReadonlySet<Phase> = new Set<Phase>([
  "idle",
  "shape",
  "specify",
  "design",
  "plan",
  "implement",
  "context",
  "verify",
  "review",
  "integrate",
  "deliver",
  "publish",
  "archive",
  "done",
]);

export function assertSpecialistRegistryIntegrity(): void {
  const ids = new Set<string>();
  for (const entry of SPECIALISTS) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id)) {
      throw new Error(`Specialist id must be a lowercase slug: ${entry.id}`);
    }
    if (ids.has(entry.id)) {
      throw new Error(`Duplicate specialist id: ${entry.id}`);
    }
    ids.add(entry.id);
    if (entry.riskFloor === null && !entry.uiSurface) {
      throw new Error(`Specialist ${entry.id} declares no trigger.`);
    }
    if (entry.contextSlice.length === 0) {
      throw new Error(`Specialist ${entry.id} declares an empty context slice.`);
    }
    if (entry.gatePhases.length === 0) {
      throw new Error(`Specialist ${entry.id} declares no gate phase.`);
    }
    if (entry.domain.length === 0) {
      throw new Error(`Specialist ${entry.id} declares an empty blocking domain.`);
    }
    for (const phase of entry.gatePhases) {
      if (!KNOWN_PHASES.has(phase)) {
        throw new Error(`Specialist ${entry.id} gates an unknown phase: ${phase}`);
      }
    }
  }
}

assertSpecialistRegistryIntegrity();

export function specialistById(id: string): SpecialistDefinition | undefined {
  return SPECIALISTS.find((entry) => entry.id === id);
}

export interface DeriveConsultsInput {
  riskFloor: RiskFloor;
  criteria?: readonly Criterion[] | undefined;
}

/**
 * Derive the required specialist ids from the work itself. Deliberately accepts
 * no caller-supplied specialist names: the set must not be forgeable.
 */
export function deriveConsults(input: DeriveConsultsInput): string[] {
  const floorIndex = RISK_ORDER.indexOf(input.riskFloor);
  if (floorIndex < 0) {
    throw new Error(`Unknown risk floor: ${input.riskFloor}`);
  }
  const hasUi = (input.criteria ?? []).some((criterion) => criterion.ui);
  const required = SPECIALISTS.filter((entry) => {
    const byRisk =
      entry.riskFloor !== null && floorIndex >= RISK_ORDER.indexOf(entry.riskFloor);
    const bySurface = entry.uiSurface && hasUi;
    return byRisk || bySurface;
  });
  return required.map((entry) => entry.id).sort();
}

export function consultAdvisoryPath(feature: string, specialistId: string): string {
  return `.empirical/specs/${feature}/consults/${specialistId}.md`;
}

export interface ConsultFinding {
  severity: FindingSeverity;
  category: string;
  location: string;
  recommendation: string;
}

export interface ConsultAdvisory {
  specialist: string;
  verdict: ConsultVerdict;
  findings: ConsultFinding[];
}

function fieldValue(line: string, label: string): string | null {
  const match = new RegExp(`^-\\s*${label}\\s*:\\s*(.+)$`, "i").exec(line.trim());
  return match ? match[1]!.trim() : null;
}

/**
 * Strict advisory parse. Fails closed: anything malformed throws rather than
 * being treated as a pass.
 */
export function parseConsultAdvisory(text: string): ConsultAdvisory {
  const lines = text.split(/\r?\n/);
  let specialistId: string | null = null;
  let verdict: ConsultVerdict | null = null;
  const findings: ConsultFinding[] = [];
  let current: Partial<ConsultFinding> | null = null;

  const flush = (): void => {
    if (!current) return;
    const { severity, category, location, recommendation } = current;
    if (!severity || !category || !location || !recommendation) {
      throw new Error("Consult finding requires severity, category, location, and recommendation.");
    }
    findings.push({ severity, category, location, recommendation });
    current = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();

    const specialistField = fieldValue(trimmed, "specialist");
    if (specialistField !== null) {
      if (specialistId !== null) throw new Error("Consult advisory declares more than one specialist.");
      if (!specialistById(specialistField)) {
        throw new Error(`Consult advisory names an unknown specialist: ${specialistField}`);
      }
      specialistId = specialistField;
      continue;
    }

    const verdictField = fieldValue(trimmed, "verdict");
    if (verdictField !== null) {
      if (verdict !== null) throw new Error("Consult advisory declares more than one verdict.");
      const normalized = verdictField.toLowerCase();
      if (!VERDICTS.includes(normalized as ConsultVerdict)) {
        throw new Error(`Consult advisory has an unknown verdict: ${verdictField}`);
      }
      verdict = normalized as ConsultVerdict;
      continue;
    }

    if (/^###\s+Finding\b/i.test(trimmed)) {
      flush();
      current = {};
      continue;
    }

    if (current) {
      const severity = fieldValue(trimmed, "severity");
      if (severity !== null) {
        const normalized = severity.toLowerCase();
        if (!SEVERITIES.includes(normalized as FindingSeverity)) {
          throw new Error(`Consult finding has an unknown severity: ${severity}`);
        }
        current.severity = normalized as FindingSeverity;
        continue;
      }
      const category = fieldValue(trimmed, "category");
      if (category !== null) {
        current.category = category.toLowerCase();
        continue;
      }
      const location = fieldValue(trimmed, "location");
      if (location !== null) {
        current.location = location;
        continue;
      }
      const recommendation = fieldValue(trimmed, "recommendation");
      if (recommendation !== null) {
        current.recommendation = recommendation;
        continue;
      }
    }
  }
  flush();

  if (!specialistId) throw new Error("Consult advisory does not name its specialist.");
  if (!verdict) throw new Error("Consult advisory does not declare a verdict.");
  if (verdict === "blocking" && findings.length === 0) {
    throw new Error("A blocking consult advisory must record at least one finding.");
  }
  return { specialist: specialistId, verdict, findings };
}

/**
 * A finding stops a gate only when the advisory blocks, the severity is
 * critical or high, and the category is inside the specialist's own domain.
 */
export function blockingFinding(
  definition: SpecialistDefinition,
  advisory: ConsultAdvisory,
): ConsultFinding | null {
  if (advisory.verdict !== "blocking") return null;
  return (
    advisory.findings.find(
      (finding) =>
        BLOCKING_SEVERITIES.includes(finding.severity) &&
        definition.domain.includes(finding.category),
    ) ?? null
  );
}

export interface ConsultPacket {
  specialist: string;
  title: string;
  charter: string;
  question: string;
  contextSlice: string[];
  advisoryPath: string;
  gatePhases: Phase[];
  domain: string[];
}

export function consultPackets(feature: string, specialistIds: readonly string[]): ConsultPacket[] {
  return specialistIds.flatMap((id) => {
    const definition = specialistById(id);
    if (!definition) return [];
    return [
      {
        specialist: definition.id,
        title: definition.title,
        charter: definition.charter,
        question: definition.question,
        contextSlice: definition.contextSlice.map(
          (entry) => `.empirical/specs/${feature}/${entry}`,
        ),
        advisoryPath: consultAdvisoryPath(feature, definition.id),
        gatePhases: [...definition.gatePhases],
        domain: [...definition.domain],
      },
    ];
  });
}

export interface ConsultEvaluationInput {
  feature: string;
  phase: Phase;
  riskFloor: RiskFloor;
  criteria?: readonly Criterion[] | undefined;
  /** Returns the advisory text, or null when the artifact is absent. */
  readAdvisory: (path: string) => Promise<string | null>;
}

export interface ConsultEvaluation {
  required: string[];
  requiredPaths: string[];
  missingPaths: string[];
  blocked: { specialist: string; finding: ConsultFinding } | null;
}

export async function evaluateConsults(
  input: ConsultEvaluationInput,
): Promise<ConsultEvaluation> {
  const required = deriveConsults({ riskFloor: input.riskFloor, criteria: input.criteria });
  const gatedNow = required.filter((id) => {
    const definition = specialistById(id);
    return definition ? definition.gatePhases.includes(input.phase) : false;
  });

  const requiredPaths: string[] = [];
  const missingPaths: string[] = [];
  let blocked: ConsultEvaluation["blocked"] = null;

  for (const id of gatedNow) {
    const definition = specialistById(id)!;
    const path = consultAdvisoryPath(input.feature, id);
    requiredPaths.push(path);
    const text = await input.readAdvisory(path);
    if (text === null || text.trim() === "") {
      missingPaths.push(path);
      continue;
    }
    let advisory: ConsultAdvisory;
    try {
      advisory = parseConsultAdvisory(text);
    } catch {
      // Fail closed: an unreadable advisory is treated as absent, never as a pass.
      missingPaths.push(path);
      continue;
    }
    if (advisory.specialist !== id) {
      missingPaths.push(path);
      continue;
    }
    if (!blocked) {
      const finding = blockingFinding(definition, advisory);
      if (finding) blocked = { specialist: id, finding };
    }
  }

  return { required, requiredPaths, missingPaths, blocked };
}
