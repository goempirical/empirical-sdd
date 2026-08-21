# Plan: Specialist consult protocol

## Task 1 — Specialist registry and integrity (AC-1)

Create `src/specialists.ts` with the frozen `SPECIALISTS` registry seeded with
`security` and `ui-ux`, each declaring id, title, charter, question, triggers,
context slice, gate phases, and blocking domain. Add
`assertSpecialistRegistryIntegrity()` invoked at import, rejecting duplicate ids,
empty triggers, empty context slices, empty domains, and gate phases outside the
`Phase` union.

Files: `src/specialists.ts`.

## Task 2 — Deterministic derivation (AC-2, AC-3)

Implement `deriveConsults({ riskFloor, criteria })` as a pure function returning
sorted specialist ids. Threshold triggers compare against the existing
`RISK_ORDER`; surface triggers read the parsed `Criterion.ui` flag. Accept no
caller-supplied specialist input anywhere in the signature.

Files: `src/specialists.ts`.

## Task 3 — Routing exposure (AC-2, workflow-routing delta)

Add `consults: string[]` to `RouteDecision` and populate it from the risk floor
already computed in `routeRequest`. Change no existing field, ordering, or
rationale code.

Files: `src/routing.ts`.

## Task 4 — Advisory parsing (AC-6)

Implement `parseConsultAdvisory(text)` returning specialist id, verdict, and
findings with severity, location, and recommendation. Fail closed on unknown
specialist, absent or duplicate verdict, unknown severity, and malformed finding
rows. Treat an explicit no-findings advisory as valid and passing.

Files: `src/specialists.ts`.

## Task 5 — Evaluation and blocking (AC-7, AC-8)

Implement `evaluateConsults({ feature, phase, riskFloor, criteria, read })`
returning required paths, missing paths, and the first in-domain blocking
finding. Restrict blocking to a `blocking` verdict with a `critical` or `high`
finding whose category is inside the specialist's declared domain.

Files: `src/specialists.ts`.

## Task 6 — Gate integration (AC-3, AC-7, AC-9, AC-10)

Wire evaluation into `src/core.ts`: append the consult obligation in
`instructionsFor`, add advisory paths in `expectedArtifacts`, and surface missing
or blocked advisories through the existing `requiredContext`, `missingContext`,
and `gate` fields. Perform no state mutation, no revision change, and no
send-back.

Files: `src/core.ts`.

## Task 7 — Read-only consult operation (AC-4, AC-5)

Register a `consult` operation (`readOnly: true`) in `src/operations.ts` and
implement its handler to return one bounded packet per required specialist.
Confirm MCP exposure and internal CLI dispatch follow from the registry.

Files: `src/operations.ts`, `src/core.ts`, `src/cli.ts`, `src/mcp.ts`.

## Task 8 — Tests (AC-1 … AC-10)

Add `tests/specialists.test.ts` covering registry integrity failures, derivation
across sensitive/UI/both/neither, determinism, caller-input rejection, slice
narrowness as a strict subset of the phase packet, advisory parsing across all
six cases, gate stop-then-proceed, and unchanged packets for a
no-specialist feature. Extend `tests/mcp.test.ts` for the new tool name.

Files: `tests/specialists.test.ts`, `tests/mcp.test.ts`.

## Task 9 — Documentation and gates (AC-10)

Update `docs/architecture.md`, `docs/protocol.md`, and `docs/mcp.md` for the new
module, artifact, and operation. Update `scripts/check-consistency.ts` operation
expectations if it pins a count. Run `bun run ci`.

Files: `docs/*.md`, `scripts/check-consistency.ts`.
