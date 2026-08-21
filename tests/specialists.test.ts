import { describe, expect, test } from "bun:test";

import { parseCriteria } from "../src/core.js";
import { routeRequest } from "../src/routing.js";
import {
  SPECIALISTS,
  assertSpecialistRegistryIntegrity,
  blockingFinding,
  consultAdvisoryPath,
  consultPackets,
  deriveConsults,
  evaluateConsults,
  parseConsultAdvisory,
  specialistById,
} from "../src/specialists.js";
import type { Criterion } from "../src/types.js";

function criterion(id: string, text: string, ui = false): Criterion {
  return { id, text, ui, checked: false };
}

const HEADER = "# Security consult\n\n- Specialist: security\n";

function finding(severity: string, category: string): string {
  return `\n### Finding 1\n\n- Severity: ${severity}\n- Category: ${category}\n- Location: src/a.ts:3\n- Recommendation: Fix it.\n`;
}

describe("specialist registry", () => {
  test("integrity holds for the shipped registry", () => {
    expect(() => assertSpecialistRegistryIntegrity()).not.toThrow();
    expect(SPECIALISTS.length).toBeGreaterThan(0);
  });

  test("every specialist declares a trigger, a slice, a gate and a domain", () => {
    for (const entry of SPECIALISTS) {
      expect(entry.riskFloor !== null || entry.uiSurface).toBe(true);
      expect(entry.contextSlice.length).toBeGreaterThan(0);
      expect(entry.gatePhases.length).toBeGreaterThan(0);
      expect(entry.domain.length).toBeGreaterThan(0);
    }
  });

  test("registry entries are frozen against mutation", () => {
    const security = specialistById("security");
    expect(security).toBeDefined();
    expect(Object.isFrozen(security)).toBe(true);
    expect(Object.isFrozen(security!.domain)).toBe(true);
  });
});

describe("derivation", () => {
  test("a sensitive risk floor requires the security consult", () => {
    expect(deriveConsults({ riskFloor: "sensitive" })).toContain("security");
  });

  test("floors above sensitive still require security", () => {
    for (const floor of ["migration", "integration", "delivery", "publication"] as const) {
      expect(deriveConsults({ riskFloor: floor })).toContain("security");
    }
  });

  test("a UI criterion requires the ui-ux consult", () => {
    const consults = deriveConsults({
      riskFloor: "behavioral",
      criteria: [criterion("AC-1", "[UI] The result is visible", true)],
    });
    expect(consults).toEqual(["ui-ux"]);
  });

  test("both surfaces require both specialists, sorted", () => {
    const consults = deriveConsults({
      riskFloor: "sensitive",
      criteria: [criterion("AC-1", "[UI] visible", true)],
    });
    expect(consults).toEqual(["security", "ui-ux"]);
  });

  test("neither surface requires nothing", () => {
    expect(deriveConsults({ riskFloor: "contract-neutral" })).toEqual([]);
    expect(deriveConsults({ riskFloor: "behavioral" })).toEqual([]);
  });

  test("derivation is deterministic across repeated evaluation", () => {
    const input = {
      riskFloor: "sensitive" as const,
      criteria: [criterion("AC-1", "[UI] visible", true)],
    };
    expect(deriveConsults(input)).toEqual(deriveConsults(input));
  });

  test("an unknown risk floor is rejected rather than silently empty", () => {
    expect(() => deriveConsults({ riskFloor: "not-a-floor" as never })).toThrow();
  });

  test("routing exposes the derived set without changing its other outcomes", () => {
    const decision = routeRequest({ request: "add authentication to the admin endpoint" });
    expect(decision.riskFloor).toBe("sensitive");
    expect(decision.profile).toBe("complex");
    expect(decision.consults).toEqual(["security"]);

    const neutral = routeRequest({ request: "fix a typo in a comment" });
    expect(neutral.consults).toEqual([]);
  });

  test("naming a specialist in the request does not summon it", () => {
    // ui-ux is derived from a [UI] criterion surface, never from request prose,
    // so mentioning it cannot pull it into the required set.
    const decision = routeRequest({
      request: "rename a local variable and tidy the ui-ux notes",
    });
    expect(decision.consults).not.toContain("ui-ux");
  });

  test("derivation takes no caller-supplied specialist input at all", () => {
    // The structural guarantee: there is no parameter through which a caller
    // could assert a consult set, so the only inputs are risk floor and criteria.
    const derived = deriveConsults({
      riskFloor: "contract-neutral",
      criteria: [criterion("AC-1", "mentions security and ui-ux in prose")],
    });
    expect(derived).toEqual([]);
  });
});

describe("packets", () => {
  test("every returned slice is bounded to the feature and non-empty", () => {
    const packets = consultPackets("demo", ["security", "ui-ux"]);
    expect(packets.length).toBe(2);
    for (const packet of packets) {
      expect(packet.contextSlice.length).toBeGreaterThan(0);
      for (const path of packet.contextSlice) {
        expect(path.startsWith(".empirical/specs/demo/")).toBe(true);
      }
      expect(packet.contextSlice).not.toContain(".empirical/specs/demo");
      expect(packet.question.length).toBeGreaterThan(0);
      expect(packet.advisoryPath).toBe(consultAdvisoryPath("demo", packet.specialist));
    }
  });

  test("a slice never claims the whole specification directory", () => {
    for (const packet of consultPackets("demo", ["security", "ui-ux"])) {
      expect(packet.contextSlice.some((path) => path.endsWith("/demo"))).toBe(false);
    }
  });

  test("a slice is a strict subset of what the phase packet already requires", () => {
    // AC-5. The phase packet for a Complex feature requires the full artifact
    // set below; a consult must see strictly less than that, which is the
    // property that makes it cheaper than a handoff rather than more expensive.
    const phaseContext = [
      ".empirical/specs/demo/spec.md",
      ".empirical/specs/demo/design.md",
      ".empirical/specs/demo/plan.md",
      ".empirical/specs/demo/decisions.md",
      ".empirical/specs/demo/deltas",
    ];
    for (const packet of consultPackets("demo", ["security", "ui-ux"])) {
      for (const path of packet.contextSlice) {
        expect(phaseContext).toContain(path);
      }
      expect(packet.contextSlice.length).toBeLessThan(phaseContext.length);
    }
  });

  test("unknown specialist ids yield no packet rather than an unbounded one", () => {
    expect(consultPackets("demo", ["nope"])).toEqual([]);
  });
});

describe("advisory parsing", () => {
  test("an advisory with no findings is valid and passing", () => {
    const advisory = parseConsultAdvisory(`${HEADER}- Verdict: advisory\n`);
    expect(advisory.specialist).toBe("security");
    expect(advisory.verdict).toBe("advisory");
    expect(advisory.findings).toEqual([]);
  });

  test("a structured finding is parsed", () => {
    const advisory = parseConsultAdvisory(
      `${HEADER}- Verdict: blocking\n${finding("high", "injection")}`,
    );
    expect(advisory.findings.length).toBe(1);
    expect(advisory.findings[0]).toEqual({
      severity: "high",
      category: "injection",
      location: "src/a.ts:3",
      recommendation: "Fix it.",
    });
  });

  test("a missing verdict fails closed", () => {
    expect(() => parseConsultAdvisory(HEADER)).toThrow();
  });

  test("a missing specialist fails closed", () => {
    expect(() => parseConsultAdvisory("- Verdict: advisory\n")).toThrow();
  });

  test("an unknown specialist fails closed", () => {
    expect(() =>
      parseConsultAdvisory("- Specialist: astrologer\n- Verdict: advisory\n"),
    ).toThrow();
  });

  test("an unknown severity fails closed", () => {
    expect(() =>
      parseConsultAdvisory(`${HEADER}- Verdict: blocking\n${finding("apocalyptic", "injection")}`),
    ).toThrow();
  });

  test("an incomplete finding fails closed", () => {
    expect(() =>
      parseConsultAdvisory(
        `${HEADER}- Verdict: blocking\n\n### Finding 1\n\n- Severity: high\n- Category: injection\n`,
      ),
    ).toThrow();
  });

  test("a blocking verdict with no finding fails closed", () => {
    expect(() => parseConsultAdvisory(`${HEADER}- Verdict: blocking\n`)).toThrow();
  });

  test("duplicate verdicts fail closed", () => {
    expect(() =>
      parseConsultAdvisory(`${HEADER}- Verdict: advisory\n- Verdict: blocking\n`),
    ).toThrow();
  });
});

describe("blocking is advisory-by-default and domain-scoped", () => {
  const security = specialistById("security")!;

  test("an advisory verdict never blocks, whatever the severity", () => {
    const advisory = parseConsultAdvisory(
      `${HEADER}- Verdict: advisory\n${finding("critical", "injection")}`,
    );
    expect(blockingFinding(security, advisory)).toBeNull();
  });

  test("a blocking in-domain critical finding blocks", () => {
    const advisory = parseConsultAdvisory(
      `${HEADER}- Verdict: blocking\n${finding("critical", "authorization")}`,
    );
    expect(blockingFinding(security, advisory)?.category).toBe("authorization");
  });

  test("a blocking out-of-domain finding does not block", () => {
    const advisory = parseConsultAdvisory(
      `${HEADER}- Verdict: blocking\n${finding("critical", "layout")}`,
    );
    expect(blockingFinding(security, advisory)).toBeNull();
  });

  test("a low in-domain finding does not block", () => {
    const advisory = parseConsultAdvisory(
      `${HEADER}- Verdict: blocking\n${finding("low", "secrets")}`,
    );
    expect(blockingFinding(security, advisory)).toBeNull();
  });
});

describe("evaluation against a gate", () => {
  const base = { feature: "demo", riskFloor: "sensitive" as const };

  test("a required advisory that is absent blocks its gate phase", async () => {
    const result = await evaluateConsults({
      ...base,
      phase: "verify",
      readAdvisory: async () => null,
    });
    expect(result.required).toEqual(["security"]);
    expect(result.missingPaths).toEqual([consultAdvisoryPath("demo", "security")]);
  });

  test("a valid advisory clears the gate", async () => {
    const result = await evaluateConsults({
      ...base,
      phase: "verify",
      readAdvisory: async () => `${HEADER}- Verdict: advisory\n`,
    });
    expect(result.missingPaths).toEqual([]);
    expect(result.blocked).toBeNull();
  });

  test("a malformed advisory is treated as missing, never as a pass", async () => {
    const result = await evaluateConsults({
      ...base,
      phase: "verify",
      readAdvisory: async () => "nonsense that is not an advisory",
    });
    expect(result.missingPaths.length).toBe(1);
  });

  test("an empty advisory file is treated as missing", async () => {
    const result = await evaluateConsults({
      ...base,
      phase: "verify",
      readAdvisory: async () => "   \n",
    });
    expect(result.missingPaths.length).toBe(1);
  });

  test("an advisory naming a different specialist is rejected", async () => {
    const result = await evaluateConsults({
      ...base,
      phase: "verify",
      readAdvisory: async () => "- Specialist: ui-ux\n- Verdict: advisory\n",
    });
    expect(result.missingPaths.length).toBe(1);
  });

  test("a blocking in-domain finding is reported", async () => {
    const result = await evaluateConsults({
      ...base,
      phase: "verify",
      readAdvisory: async () => `${HEADER}- Verdict: blocking\n${finding("high", "secrets")}`,
    });
    expect(result.blocked?.specialist).toBe("security");
    expect(result.blocked?.finding.category).toBe("secrets");
  });

  test("a specialist is only gated at its declared phase", async () => {
    const result = await evaluateConsults({
      ...base,
      phase: "implement",
      readAdvisory: async () => null,
    });
    expect(result.required).toEqual(["security"]);
    expect(result.requiredPaths).toEqual([]);
    expect(result.missingPaths).toEqual([]);
  });

  test("a feature with no specialist surface owes nothing", async () => {
    const result = await evaluateConsults({
      feature: "demo",
      phase: "verify",
      riskFloor: "contract-neutral",
      readAdvisory: async () => null,
    });
    expect(result.required).toEqual([]);
    expect(result.requiredPaths).toEqual([]);
    expect(result.missingPaths).toEqual([]);
    expect(result.blocked).toBeNull();
  });
});

describe("the [UI] tag is a tag, not a substring", () => {
  test("a tagged criterion is detected", () => {
    const [parsed] = parseCriteria("- [ ] [AC-UI-1] [UI] The result is visible in the browser.");
    expect(parsed?.ui).toBe(true);
  });

  test("a criterion that merely mentions the token is not a UI criterion", () => {
    const [parsed] = parseCriteria(
      "- [ ] [AC-1] Any [UI] acceptance criterion requires the ui-ux consult.",
    );
    expect(parsed?.ui).toBe(false);
  });

  test("a prose mention does not derive the ui-ux consult", () => {
    const criteria = parseCriteria(
      "- [ ] [AC-1] Any [UI] acceptance criterion requires the ui-ux consult.",
    );
    expect(deriveConsults({ riskFloor: "behavioral", criteria })).toEqual([]);
  });
});
