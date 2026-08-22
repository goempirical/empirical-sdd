# Specialist Consults

## Purpose

Bring specialist expertise to the work whose surface needs it, as a bounded
advisory that produces reviewable evidence, without introducing standing roles,
personas, or handoff chains.

## ADDED Requirements

### Requirement: Specialists are a frozen, integrity-asserted registry

Empirical SHALL define specialists in one frozen registry. Each entry MUST carry
a stable id, title, charter, at least one trigger signal, at least one bounded
context-slice path, exactly one question, the phases at which it is gated, and
the domain in which it may block. Registry integrity MUST be asserted at import
and MUST reject duplicate ids, empty triggers, empty context slices, and gate
phases that are not real workflow phases.

#### Scenario: A specialist declares no context slice

- **WHEN** the registry is loaded
- **THEN** import fails with the offending specialist id
- **AND** no operation can return an unbounded consult packet

### Requirement: Required consults are derived, never declared

Empirical SHALL derive the required consult set deterministically from the
selected feature's request risk floor and its acceptance-criteria surfaces. The
set MUST NOT be supplied by the caller, MUST NOT be persisted as workflow state,
and MUST NOT require a schema migration. Identical request and criteria MUST
always produce an identical consult set.

#### Scenario: An agent supplies its own consult set

- **WHEN** any caller input names specialists
- **THEN** the input is ignored for gating purposes
- **AND** the derived set alone determines which advisories are required

#### Scenario: A request names a sensitive boundary

- **WHEN** the routed risk floor is `sensitive` or higher
- **THEN** the `security` consult is required
- **AND** its advisory path is reported as required context for its gate phase

### Requirement: A consult packet is strictly narrower than its phase packet

The read-only consult operation SHALL return one packet per required specialist
containing the charter, the bounded context slice, the single question, and the
exact advisory artifact path. Each returned context slice MUST be a strict
subset of the current phase packet's required context and MUST NOT include the
entire specification.

#### Scenario: A feature requires two specialists

- **WHEN** the consult operation is read
- **THEN** each specialist receives only paths inside its own declared domain
- **AND** neither packet reproduces the full phase context

### Requirement: Advisories are structured, validated, and fail closed

A consult advisory SHALL be stored at
`.empirical/specs/<feature>/consults/<specialist>.md` and MUST validate to one
specialist id, exactly one verdict of `advisory` or `blocking`, and zero or more
findings each carrying severity, location, and recommendation. An explicit
no-findings advisory MUST be a valid passing result. A required advisory that is
missing, unreadable, or structurally invalid MUST block its gate phase and MUST
be reported as missing context with a `stop` gate verdict.

#### Scenario: A required advisory is absent

- **WHEN** the gated phase is evaluated
- **THEN** the exact advisory path appears in missing context
- **AND** the gate verdict is `stop`

#### Scenario: A specialist reports no findings

- **WHEN** the advisory records the no-findings verdict explicitly
- **THEN** the gate proceeds
- **AND** the advisory remains as reviewable evidence

### Requirement: Blocking is advisory-by-default and domain-scoped

A consult verdict SHALL be advisory unless it is `blocking` and carries at least
one `critical` or `high` finding inside that specialist's own declared domain.
Only such a verdict MUST stop the gate, and the block MUST name the offending
finding. Findings outside the declared domain MUST NOT stop the gate.

#### Scenario: A specialist blocks outside its domain

- **WHEN** its only high finding lies outside its declared domain
- **THEN** the gate proceeds
- **AND** the finding remains recorded as advisory evidence

### Requirement: Consults never transition workflow state

A consult MUST NOT change phase, status, revision, actor, or completion level,
MUST NOT trigger a send-back, and MUST persist only externally reviewable
evidence. Raw model reasoning, prompts, scratchpads, credentials, and tokens
MUST NOT be written to a consult advisory.

#### Scenario: A consult is read twice

- **WHEN** the read-only consult operation runs repeatedly
- **THEN** no journal event or revision is created
- **AND** the workflow state is byte-identical afterwards

### Requirement: Surfaces without specialists cost nothing

A feature whose request and criteria trigger no specialist MUST require no
consult, MUST add no artifact to its expected artifacts, and MUST produce
packets identical to the pre-protocol behavior.

#### Scenario: A contract-neutral feature runs end to end

- **WHEN** no trigger signal matches
- **THEN** no consult path appears in required or missing context
- **AND** every existing gate behaves exactly as before
