# External Ticket Tracking

## Purpose

Mirror authoritative Empirical progress to one optional external ticket without
allowing remote availability or state to weaken the local SDD protocol.

## ADDED Requirements

### Requirement: Tracking is optional and one-way

Empirical SHALL default to local-only tracking and MUST perform no provider
request without explicit project configuration and a feature binding. GitHub,
Linear, and Jira tickets are projections only: remote data MUST NOT mutate,
advance, pause, retry, reroute, or complete local workflow state.

#### Scenario: A remote ticket is moved manually

- **WHEN** its status differs from the bound Empirical feature
- **THEN** the next outbound projection restores the configured Empirical state
- **AND** no Empirical revision is created from the remote change

### Requirement: Feature bindings are explicit and secret-free

The single Empirical skill SHALL create or attach at most one provider ticket
to a feature through granular MCP operations. A binding MUST contain only the
provider, remote identity, safe URL, synchronization revisions, and bounded
diagnostics. Rebinding requires an explicit replacement operation; credential
values and authorization material MUST NOT be persisted.

#### Scenario: A feature is attached to an existing ticket

- **WHEN** the provider validates the supplied remote identity
- **THEN** Empirical records one immutable provider/remote-id association
- **AND** queues the current committed revision for projection

### Requirement: Remote effects follow local commits

Empirical MUST commit its journal event and state projection before attempting
a ticket effect. Provider failure MUST leave the local revision successful and
create or retain reconstructable, durable, secret-free pending work with a
stable idempotency key. Interrupted enqueue, retries, and lost responses MUST
converge without duplicate logical ticket updates.

#### Scenario: The provider is unavailable during phase completion

- **WHEN** the local phase passes and the outbound request fails
- **THEN** the next Empirical action reflects the advanced local revision
- **AND** tracker health reports pending or failed work that can be retried

### Requirement: Progress projection is exact and configurable

Empirical SHALL normalize its phases and stop conditions into documented
progress states, then resolve those states only through the project's explicit
provider mapping. Every projection MUST carry a stable marker and the feature,
phase, workflow status, revision, highest completion level, and any bounded
blocked or awaiting-human summary.

#### Scenario: Verification requires human input

- **WHEN** the feature commits an `awaiting_human` Verify revision
- **THEN** the configured remote state is selected deterministically
- **AND** the remote Empirical marker identifies the exact Verify revision and gate

### Requirement: Provider adapters share one validated contract

GitHub, Linear, and Jira adapters MUST implement the same create, attach,
project, and transition contract over an injectable bounded HTTP transport.
They MUST resolve authentication from documented environment variables at call
time, validate remote responses, redact stored failures, and make provider
differences explicit rather than inferring workflow identifiers.

#### Scenario: A provider returns malformed success data

- **WHEN** a create or update response lacks its required remote identity
- **THEN** the adapter records a safe synchronization failure
- **AND** no invalid binding or synchronized revision is persisted

### Requirement: Tracker health is observable

Structured and human status/action output MUST report `local-only`, `pending`,
`synced`, or `failed` plus safe provider, URL, committed revision,
last-synchronized revision, and bounded failure context. Status inspection MUST
remain local and MUST NOT contact the provider.

#### Scenario: All pending projections are acknowledged

- **WHEN** synchronization converges through the current committed revision
- **THEN** status reports `synced` with matching committed and synchronized revisions
- **AND** repeated status reads perform no network request
