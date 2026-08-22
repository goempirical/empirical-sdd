import type { ExecutionMode, RiskFloor, Workflow } from "./protocol.js";
import { deriveConsults } from "./specialists.js";

const RISK_ORDER: readonly RiskFloor[] = [
  "contract-neutral",
  "behavioral",
  "sensitive",
  "migration",
  "integration",
  "delivery",
  "publication",
] as const;

const SIGNALS: ReadonlyArray<{
  floor: RiskFloor;
  code: string;
  pattern: RegExp;
}> = [
  {
    floor: "publication",
    code: "publication-request",
    pattern: /\b(publish|release|npm\s+(?:publish|version)|dist[- ]?tag|git\s+tag|github\s+release)\b/i,
  },
  {
    floor: "delivery",
    code: "remote-delivery",
    pattern: /\b(push|pull request|\bpr\b|merge on github|github checks?|remote branch)\b/i,
  },
  {
    floor: "integration",
    code: "integration-change",
    pattern: /\b(integrat(?:e|ion)|rebase|cross[- ]worktree|parallel worktree|capability claims?|target branch)\b/i,
  },
  {
    floor: "migration",
    code: "persisted-state-migration",
    pattern: /\b(migrat(?:e|ion)|schema\s*[0-9]+|persisted state|data format|journal compaction)\b/i,
  },
  {
    floor: "sensitive",
    code: "sensitive-boundary",
    pattern: /\b(security|credential|secret|permission|authorization|authentication|destructive|delete branch|force[- ]?push|branch protection)\b/i,
  },
  {
    floor: "behavioral",
    code: "behavioral-change",
    pattern: /\b(add|implement|change|fix|feature|behavior|workflow|api|cli|mcp|ui|user can)\b/i,
  },
];

const CONTRACT_NEUTRAL =
  /\b(typo|spelling|format(?:ting)? only|comments? only|rename local|internal refactor|test refactor|docs? punctuation)\b/i;

export interface RouteInput {
  request: string;
  mode?: ExecutionMode;
  requestedProfile?: Workflow;
  declaredContractNeutral?: boolean;
}

export interface RouteDecision {
  profile: Workflow;
  mode: ExecutionMode;
  riskFloor: RiskFloor;
  rationaleCodes: string[];
  gates: string[];
  promoted: boolean;
  /** Specialist ids implied by this request. Derived, never caller-supplied. */
  consults: string[];
}

function maxFloor(left: RiskFloor, right: RiskFloor): RiskFloor {
  return RISK_ORDER.indexOf(left) >= RISK_ORDER.indexOf(right) ? left : right;
}

export function routeRequest(input: RouteInput): RouteDecision {
  const request = input.request.trim();
  if (!request) {
    throw new Error("Routing requires a non-empty request.");
  }
  const mode = input.mode ?? "normal";
  const rationaleCodes: string[] = [];
  let riskFloor: RiskFloor = "contract-neutral";

  for (const signal of SIGNALS) {
    if (signal.pattern.test(request)) {
      riskFloor = maxFloor(riskFloor, signal.floor);
      rationaleCodes.push(signal.code);
    }
  }

  const explicitNeutral = input.declaredContractNeutral === true;
  const neutralLanguage = CONTRACT_NEUTRAL.test(request);
  if (
    (explicitNeutral || neutralLanguage) &&
    RISK_ORDER.indexOf(riskFloor) <= RISK_ORDER.indexOf("behavioral")
  ) {
    riskFloor = "contract-neutral";
    rationaleCodes.push(
      explicitNeutral ? "declared-contract-neutral" : "contract-neutral-language",
    );
    const genericBehavior = rationaleCodes.indexOf("behavioral-change");
    if (genericBehavior >= 0) {
      rationaleCodes.splice(genericBehavior, 1);
    }
  } else if (riskFloor === "contract-neutral") {
    if (explicitNeutral || neutralLanguage) {
      rationaleCodes.push(
        explicitNeutral ? "declared-contract-neutral" : "contract-neutral-language",
      );
    } else {
      riskFloor = "behavioral";
      rationaleCodes.push("uncertain-impact-promoted");
    }
  } else if (explicitNeutral) {
    rationaleCodes.push("neutral-declaration-overridden-by-risk");
  }

  const profile: Workflow =
    riskFloor === "contract-neutral" ? "fast" : "complex";
  const promoted = input.requestedProfile === "fast" && profile === "complex";
  if (promoted) {
    rationaleCodes.push("fast-request-promoted");
  }

  const materialGates = ["specification", "implementation", "verification", "review"];
  if (RISK_ORDER.indexOf(riskFloor) >= RISK_ORDER.indexOf("integration")) {
    materialGates.push("integration");
  }
  if (RISK_ORDER.indexOf(riskFloor) >= RISK_ORDER.indexOf("delivery")) {
    materialGates.push("delivery-authorization", "protected-merge");
  }
  if (riskFloor === "publication") {
    materialGates.push("exact-version-authorization", "immutable-artifact-check");
  }
  const gates =
    mode === "normal"
      ? materialGates
      : materialGates.filter((gate) =>
          [
            "delivery-authorization",
            "protected-merge",
            "exact-version-authorization",
            "immutable-artifact-check",
          ].includes(gate),
        );
  gates.push("host-permissions", "hard-safety-floor");

  return {
    profile,
    mode,
    riskFloor,
    rationaleCodes: [...new Set(rationaleCodes)],
    gates: [...new Set(gates)],
    promoted,
    consults: deriveConsults({ riskFloor }),
  };
}

export interface ProductQuestionContext {
  materiallyDifferentOutcomes: string[];
  repositoryResolves: boolean;
  policyResolves: boolean;
  priorDecisionResolves: boolean;
  safeDefaultResolves: boolean;
}

export function isBlockingProductQuestion(
  context: ProductQuestionContext,
): boolean {
  return (
    new Set(context.materiallyDifferentOutcomes.map((value) => value.trim()).filter(Boolean))
      .size > 1 &&
    !context.repositoryResolves &&
    !context.policyResolves &&
    !context.priorDecisionResolves &&
    !context.safeDefaultResolves
  );
}
