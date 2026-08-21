# Specialist Consult Protocol

## Request

> Add a specialist consult protocol so tagged specialists such as security and ui-ux run as focused advisories without standing roles

## Goal

A feature whose surface calls for specialist expertise receives that expertise as
a bounded, evidence-producing advisory instead of a standing role. Empirical
derives the required specialists from the work itself, hands the agent one
focused packet per specialist — charter, a context slice narrower than the phase
packet, and a single question — and gates the phase on a structured advisory
artifact. A feature whose surface calls for no specialist incurs no additional
operation, artifact, token, or gate.

## Acceptance Criteria

- [ ] [AC-1] A frozen specialist registry defines each specialist with a stable
  id, title, charter, trigger signals, bounded context-slice paths, one question,
  and the domain in which it may block. Registry integrity is asserted at import
  and rejects duplicate ids, empty triggers, empty context slices, and unknown
  gate phases.
- [ ] [AC-2] Required consults are derived deterministically from the feature's
  request and acceptance criteria. They are never hand-declared, never trusted
  from caller input, and never persisted as workflow state, so identical inputs
  always yield an identical consult set and no schema migration is required.
- [ ] [AC-3] A risk floor of `sensitive` or higher requires the `security`
  consult; any `[UI]` acceptance criterion requires the `ui-ux` consult; a
  feature with neither surface requires no consult and its packets are unchanged.
- [ ] [AC-4] A read-only `consult` operation returns, for the selected feature,
  every required specialist packet containing the charter, the exact bounded
  context slice, the single question, and the exact advisory artifact path to
  write.
- [ ] [AC-5] Each returned context slice is strictly narrower than the current
  phase packet's required context: it names only paths within that specialist's
  declared domain and never the entire specification.
- [ ] [AC-6] A consult advisory is stored at
  `.empirical/specs/<feature>/consults/<specialist>.md` and validates
  structurally: specialist id, one verdict of exactly `advisory` or `blocking`,
  and zero or more findings each carrying severity, location, and recommendation.
  An explicit no-findings advisory is a valid, passing result.
- [ ] [AC-7] A required consult whose advisory is missing, unreadable, or
  structurally invalid blocks its gate phase, and the action packet reports the
  exact path under `missingContext` with a `stop` gate verdict.
- [ ] [AC-8] A consult is advisory by default. Only a `blocking` verdict carrying
  at least one `critical` or `high` finding inside that specialist's own declared
  domain stops the gate, and the resulting block message names the offending
  finding.
- [ ] [AC-9] A consult performs no workflow transition, no actor change, no
  send-back, and no revision mutation, and its advisory persists only externally
  reviewable evidence — never raw model reasoning, prompts, or scratchpads.
- [ ] [AC-10] Existing Schema-5 repositories and features open with no migration
  prompt and no new required artifact, and type checking, tests, coverage,
  distribution smoke, package inspection, and consistency checks pass.

## Scope

- A frozen specialist registry with integrity assertion, seeded with `security`
  and `ui-ux`.
- Deterministic derivation of required consults from request risk floor and
  acceptance-criteria surfaces.
- One read-only `consult` operation returning bounded per-specialist packets.
- Structured advisory parsing, validation, and domain-scoped blocking.
- Gate integration for the phases each specialist declares, including
  `missingContext` reporting in the action packet.

## Non-goals

- Standing roles, named personas, role charters, or send-back choreography
  between roles.
- Orchestrating specialist sub-agents. Empirical specifies the consult; the host
  agent decides how to execute it.
- Multi-round negotiation between a specialist and the implementer.
- Blocking on findings outside the specialist's declared domain.
- Persisting the consult set in workflow state or changing `SCHEMA_VERSION`.
- Replacing the deterministic risk-floor routing, evidence receipts, review,
  integration, delivery, or publication gates.

## Risks

- A consult that receives the whole specification would reintroduce the context
  fragmentation and token cost that standing roles caused. The slice must be
  asserted narrower than the phase packet, not merely documented as such.
- Caller-supplied consult sets would let an agent talk its way out of a security
  gate. Derivation must be internal and unforgeable.
- An over-broad trigger regex would force consults onto unrelated work and make
  the protocol feel like tax. Triggers reuse the existing routing signals rather
  than inventing a parallel classifier.
- A blocking verdict outside the specialist's domain would let one specialist
  veto unrelated design. Blocking is domain-scoped and asserted.
- Free-form advisories would rot into prose nobody gates on. Structure is
  validated, and an invalid advisory fails closed.

## Verification

- Unit-test registry integrity for duplicate ids, empty triggers, empty context
  slices, and unknown gate phases.
- Unit-test derivation across: sensitive request, `[UI]` criteria, both, and
  neither; assert determinism over repeated evaluation and independence from
  caller input.
- Assert every returned context slice is a strict subset of the phase packet's
  required context.
- Unit-test advisory parsing for valid advisory, valid no-findings advisory,
  blocking in-domain, blocking out-of-domain, malformed, and absent.
- Exercise a gated phase that stops on a missing advisory and proceeds once the
  advisory is written.
- Assert a feature with no specialist surface produces byte-identical packets to
  the pre-change behavior.
- Run the configured `ci` evidence command against AC-1 through AC-10.

## Capability Deltas

- `deltas/specialist-consults.md` adds the derived, bounded, advisory-producing
  consult protocol.
- `deltas/workflow-routing.md` extends deterministic routing to emit the derived
  consult set without changing existing risk-floor or profile outcomes.
