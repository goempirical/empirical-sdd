# Design: Specialist consult protocol

## Overview

Specialists are not actors. A consult is a **derived requirement** that produces
a **structured advisory artifact**, evaluated by the phase gate that already
exists. Nothing about the workflow's actor model, revision model, or schema
changes.

Three properties carry the whole design:

1. **Derived, not declared.** The required consult set is computed from the
   feature's routed risk floor and its acceptance-criteria surfaces. It is never
   persisted and never accepted from a caller, so it cannot be forged and it
   needs no schema migration.
2. **Bounded, not broadcast.** Each consult receives a context slice named by its
   own registry entry, asserted to be a strict subset of the phase packet's
   required context. This is the property that makes a consult cheaper than a
   handoff instead of more expensive.
3. **Advisory, not authoritative.** A consult reports; it does not decide. Only a
   `blocking` verdict carrying a critical or high finding inside the specialist's
   own declared domain stops a gate.

## Module boundaries

`src/specialists.ts` is a new owner and holds the entire protocol:

- `SPECIALISTS` — a frozen registry, seeded with `security` and `ui-ux`.
- `assertSpecialistRegistryIntegrity()` — invoked at import, mirroring the
  existing `assertRegistryIntegrity()` convention in `src/operations.ts`.
- `deriveConsults(...)` — pure function over `{ riskFloor, criteria }`.
- `parseConsultAdvisory(...)` — strict parse of one advisory artifact.
- `evaluateConsults(...)` — returns required paths, missing paths, and any
  in-domain blocking finding.

`src/routing.ts` gains one field on `RouteDecision` (`consults`) computed from
the risk floor it already derives. No existing field changes.

`src/core.ts` consumes the evaluation in three narrow places: `instructionsFor`
appends the consult obligation, `expectedArtifacts` lists advisory paths, and the
gate rationale reports missing advisories through the existing `missingContext`
and `gate` fields.

`src/operations.ts` registers one read-only `consult` operation. MCP exposure,
CLI internal dispatch, and annotations follow automatically from the registry, as
they do for every other operation.

## Registry entry shape

Each specialist declares: `id`, `title`, `charter`, `question`, `triggers`
(risk-floor threshold and/or a criterion-surface predicate), `contextSlice`
(paths relative to the feature, plus repository context pages), `gatePhases`, and
`domain` (the finding categories in which it may block).

Seeded entries:

- **security** — triggered at risk floor `sensitive` or higher; gated at
  `verify`; domain covers injection, authentication and authorization, secret and
  credential handling, untrusted input, and unsafe execution.
- **ui-ux** — triggered by any `[UI]` acceptance criterion; gated at `design`;
  domain covers layout, interaction, state coverage, and visual consistency.

## Advisory artifact

`.empirical/specs/<feature>/consults/<specialist>.md`, with a strict header
(specialist id, verdict) and zero or more findings, each carrying severity,
location, and recommendation. The parse fails closed: an unreadable or malformed
advisory is treated as missing, never as passing.

An explicit no-findings advisory is a first-class passing result, so "the
specialist looked and found nothing" is recorded evidence rather than an absence
indistinguishable from "nobody looked".

## Gate integration

For each required consult whose `gatePhases` contains the current phase:

- its advisory path joins `requiredContext`;
- a missing or invalid advisory joins `missingContext` and forces gate `stop`;
- a valid advisory with an in-domain `critical` or `high` finding under a
  `blocking` verdict forces gate `stop`, naming the finding;
- anything else proceeds.

## Why not the alternatives

Persisting the consult set in `WorkflowState` would require a schema bump and a
migration, and would let a stale record disagree with the current spec.
Derivation keeps artifacts authoritative, which is the same principle the repo
already applies to phase inference.

Making consults a phase would reintroduce exactly what we removed with roles: an
actor boundary, a handoff, and a context copy.

## Verification

Unit tests cover registry integrity failures, derivation across all four surface
combinations, slice-narrowness against a real phase packet, advisory parsing
across valid/no-findings/blocking-in-domain/blocking-out-of-domain/malformed/
absent, gate stop-then-proceed, and byte-identical packets for a feature with no
specialist surface.
