# External Ticket Tracking

## Purpose

Make optional ticket tracking discoverable during repository setup and project
committed feature progress as one recoverable ticket lifecycle without copying
opaque provider identifiers, guessing workflow semantics, overwriting human
content, or exposing unapproved evidence.

## ADDED Requirements

### Requirement: Tracker setup is guided, previewable, and explicit

Initialization and repair SHALL present a Tracker section before feature work
with an explicit disabled/local-only choice and one provider-aware path for
Linear, GitHub Projects, or Jira. Configuration MUST reference credential
environment-variable names only, use the selected adapter to discover and
validate accessible target metadata, show the complete effective policy before
application, and persist neither credential values nor provider responses that
contain authorization material. Repair MUST preserve an existing tracker policy
without provider access unless the caller explicitly chooses to change or
disable it. Interactive Init and strict non-interactive core/MCP operations MUST
expose equivalent discover, suggest, validate, preview, and apply semantics.

#### Scenario: Interactive Linear setup succeeds without copied identifiers

- **WHEN** a developer selects a runtime credential source, workspace, team,
  optional project, and reviewed state mapping from discovered choices
- **THEN** Init validates access and previews the exact secret-free policy
- **AND** only the approved canonical identifiers and credential variable name
  are persisted

#### Scenario: Repair leaves tracker setup untouched

- **WHEN** an initialized repository with Tracker Policy v1 or v2 is repaired
  without an explicit tracker change
- **THEN** the tracker policy remains byte-for-byte unchanged
- **AND** repair makes no tracker provider request

#### Scenario: Tracking is explicitly disabled

- **WHEN** local-only is selected or no tracker policy exists
- **THEN** initialization, workflow, status, and Doctor perform no provider request
- **AND** no feature ticket is ensured or projected

### Requirement: Discovery and semantic mapping share one adapter contract

Every provider adapter SHALL expose bounded, paginated discovery results for
the target hierarchy and capabilities it supports: workspaces or sites, teams or
repositories, projects, issue types, fields, and workflow states. Results MUST
retain canonical identifiers and parent relationships, validate target access,
and use one provider-agnostic contract suitable for interactive and automated
callers. Mapping suggestions MUST cover `specification`, `planned`,
`in-progress`, `verification`, `review`, `blocked`, and `done`, MAY map several
phases to one provider state, and MUST report ranked candidates and reasons.
Zero candidates or an equal best rank is ambiguity and MUST require an explicit
selection before application.

Linear suggestions MUST use workflow-state type and position as primary signals
and MAY use normalized names such as Todo, In Progress, QA, Review, Blocked, and
Done only to refine otherwise compatible candidates. Names MUST NOT override
incompatible provider semantics or break a primary-signal tie by themselves.

#### Scenario: A conventional Linear workflow is suggested

- **WHEN** discovery returns ordered Todo, In Progress, QA, Review, and Done states
- **THEN** type and position establish the lifecycle regions and compatible
  names refine verification and review suggestions
- **AND** the complete editable mapping is displayed before application

#### Scenario: A simple board shares provider states

- **WHEN** a board exposes only Todo, In Progress, and Done without distinct QA
  or review states
- **THEN** Empirical permits specification/planned and in-progress/verification/
  review phases to share compatible states
- **AND** the effective seven-phase mapping remains explicit

#### Scenario: Mapping evidence is ambiguous

- **WHEN** two states have the same best provider-semantic and positional rank
  for an Empirical phase
- **THEN** the suggestion identifies both candidates and their reasons
- **AND** validation refuses to save until the caller chooses one explicitly

### Requirement: Approved evidence projection is bounded and capability-aware

Tracker adapters SHALL declare whether they support binary artifact upload and
durable link attachment. An artifact is eligible only when an immutable evidence
receipt approves it, its resolved regular-file path remains inside the
repository, and its media type, size, and path pass documented bounds. Eligible
screenshots and evidence MUST be uploaded where the adapter supports it;
otherwise Empirical SHALL attach safe durable links when available. Unsafe,
missing, symlink-escaping, secret-like, or unsupported artifacts MUST NOT be
projected and MUST produce only bounded credential-redacted diagnostics.
Acknowledged artifact effects MUST be durable so a partial retry does not upload
or attach the same feature, revision, receipt, and artifact digest twice.

#### Scenario: A receipt contains an approved screenshot

- **WHEN** the screenshot is a repository-contained regular file within bounds
  and the provider supports uploads
- **THEN** the milestone references one uploaded provider artifact
- **AND** retry after acknowledgement does not upload it again

#### Scenario: An approved artifact cannot safely cross the boundary

- **WHEN** its resolved path escapes the repository, looks secret-bearing,
  exceeds bounds, or lacks a supported upload or durable-link capability
- **THEN** the adapter performs no artifact effect
- **AND** pending health reports a safe actionable omission or failure

## MODIFIED Requirements

### Requirement: Tracking is optional and one-way

Empirical SHALL default to local-only tracking and MUST perform no provider
request without explicit project configuration. Tracker Policy v2 SHALL choose
ticket behavior `off`, `manual`, or `ensure` and progress visibility
`blockers-final`, `milestones`, or `revisions`. Policy v1 MUST remain readable
with its existing explicit/manual binding and legacy projection behavior. Remote
data is projection input only for validating a referenced identity or
reconciling an exact Empirical-owned marker; it MUST NOT mutate, advance, pause,
retry, reroute, or complete local workflow state.

#### Scenario: A remote ticket is moved manually

- **WHEN** its status differs from the bound Empirical feature
- **THEN** an eligible outbound projection restores the configured Empirical state
- **AND** no Empirical revision is created from the remote change

#### Scenario: Ticket behavior is off

- **WHEN** tracking is configured with ticket behavior `off`
- **THEN** ordinary feature operations perform no bind or provider request
- **AND** the local journal remains authoritative and tracker health explains
  that projection is disabled

#### Scenario: Tracker Policy v1 is loaded

- **WHEN** an existing repository has a valid v1 policy
- **THEN** its target, mapping, and manual binding behavior remain compatible
- **AND** v2 behavior is not persisted until explicitly previewed and applied

### Requirement: Feature bindings are explicit and secret-free

Empirical SHALL maintain at most one active target-valid provider-ticket
association per feature. In `manual` mode, granular create or attach operations
remain explicit. In `ensure` mode, Empirical MUST first validate a feature's
referenced remote identity when present, then reconcile the stable feature
marker in the configured target, and create only if neither source yields a
ticket. Exactly one valid result SHALL bind; multiple results, target mismatch,
or incomplete lookup MUST stop with durable reconciliation state. Binding,
policy, pending work, and provider URLs MUST remain credential-free, and target
changes require explicit replacement rather than reuse of an old identity.

#### Scenario: Ensure finds one referenced ticket

- **WHEN** the selected feature carries a valid reference in the configured target
- **THEN** Empirical binds it and queues eligible committed progress
- **AND** it performs no create request

#### Scenario: Ensure reconciles a stable feature marker

- **WHEN** no valid reference exists and one target-valid ticket has the exact marker
- **THEN** Empirical binds that ticket
- **AND** it creates no additional ticket

#### Scenario: Ensure finds several exact candidates

- **WHEN** marker reconciliation returns multiple target-valid tickets or
  incomplete pagination
- **THEN** Empirical preserves durable reconciliation facts and fails closed
- **AND** it neither guesses a binding nor creates a replacement

### Requirement: Remote effects follow local commits

Empirical MUST commit its journal event and state projection before attempting
any bind, transition, comment, activity, upload, or link effect. Pending work
MUST be reconstructable, durable, secret-free, and keyed by stable idempotency
identities. Create intent and dispatch state MUST be persisted before the remote
effect. A dispatched create whose response is unknown MUST only reconcile its
exact stable marker and MUST NOT be automatically resent. Comment/activity
deduplication MUST include feature, revision, and sorted receipt digest;
artifact acknowledgements MUST additionally bind the artifact digest. Partial
success persists per-effect acknowledgements and retries only missing effects.

#### Scenario: A ticket-create response is not observed

- **WHEN** a dispatched create may have succeeded but no valid binding was obtained
- **THEN** retry searches the configured target for the exact stable marker
- **AND** it cannot silently issue a second create

#### Scenario: A milestone comment succeeds before upload failure

- **WHEN** the comment is acknowledged but one eligible artifact effect fails
- **THEN** pending work retains the comment acknowledgement and missing artifact
- **AND** retry does not publish the comment a second time

#### Scenario: The provider is unavailable after local completion

- **WHEN** an eligible phase revision is durably committed and projection fails
- **THEN** local completion remains successful
- **AND** tracker health exposes exact retryable pending work with redacted failure

### Requirement: Progress projection is exact and configurable

Empirical SHALL normalize every committed phase and stop condition through the
explicit seven-state mapping. Tracker Policy v2 visibility SHALL publish only
blocked/awaiting-human and final completion for `blockers-final`, phase changes
and final completion for `milestones`, or every committed revision for
`revisions`. Every eligible projection MUST transition the provider-owned state
and publish an idempotent comment or activity containing the feature, phase,
revision, highest completion level, concise committed summary, bounded blockers,
and reviewable artifact references. New lifecycle synchronization MUST NOT
rewrite Linear descriptions or any user-authored description content. Existing
v1 Linear managed descriptions and recovery markers remain parseable for
binding and compatibility but lifecycle history is appended through provider
comments/activities.

#### Scenario: Milestone visibility skips same-phase churn

- **WHEN** a committed revision does not change phase, stop condition, or final
  completion under `milestones`
- **THEN** no milestone comment or activity is created for that revision
- **AND** later eligible progress remains projectable

#### Scenario: A Linear issue has a user-authored description

- **WHEN** state and milestone progress are synchronized
- **THEN** the description remains byte-for-byte unchanged
- **AND** the new progress record appears as a separate idempotent comment

#### Scenario: A blocker is committed under minimal visibility

- **WHEN** a feature becomes blocked under `blockers-final`
- **THEN** one progress activity includes the exact phase, revision, completion,
  concise blocker, and safe reviewable artifacts
- **AND** ordinary non-final, non-blocked revisions remain unpublished

### Requirement: Provider adapters share one validated contract

GitHub, Linear, and Jira adapters MUST implement the same discovery, target
validation, create, reference validation, marker reconciliation, transition,
comment/activity, and artifact-capability contract over injectable, size-bounded,
timeout-bounded transports. Public core and MCP setup surfaces MUST use strict
runtime-discriminated provider inputs and expose discovery and preview outputs
without mutating policy. Credential names MUST match the documented strict
uppercase grammar; credential values and permissions are resolved only at call
time and redacted from all results and durable failures. Response envelopes,
identities, parent relationships, pagination, safe URLs, and provider capability
claims MUST be validated before persistence or remote mutation.

#### Scenario: Discovery lacks required permissions

- **WHEN** a provider denies or omits access to the selected target metadata
- **THEN** validation reports a bounded permission/target error before policy save
- **AND** no partial tracker policy is persisted

#### Scenario: A non-interactive provider request mixes schemas

- **WHEN** Linear input contains GitHub or Jira target fields, unknown fields,
  or a credential value instead of an environment-variable name
- **THEN** core and MCP validation reject it before repository or network mutation
- **AND** advertised schemas remain provider-discriminated

#### Scenario: Discovery pagination is incomplete

- **WHEN** a provider page is malformed, repeats a cursor, exceeds bounds, or
  cannot reach a terminal page
- **THEN** the adapter rejects the discovery result and any derived mapping
- **AND** configuration cannot validate or persist from partial metadata

### Requirement: Tracker health is observable

Structured and human setup, preview, status, action, synchronization, and Doctor
output MUST distinguish local-only, off, pending, synced, and failed behavior
with safe provider/URL data, binding policy, visibility, committed revision,
last-synchronized revision, pending effects, and bounded failure facts. Recovery
reporting MUST distinguish target drift, mapping ambiguity, binding ambiguity,
ambiguous create, missing runtime credential, permission failure, unsafe
artifact, and ordinary retryable provider outage. Status and Doctor remain
local-only reads and MUST validate dormant v1/v2 policy, binding, pending, and
acknowledgement data without contacting a provider or mutating files.

#### Scenario: Recovery needs an operator choice

- **WHEN** setup mapping or ensure reconciliation has multiple valid candidates
- **THEN** structured and human output list bounded candidate identities and the
  explicit choice required
- **AND** no provider mutation is attempted while ambiguity remains

#### Scenario: All eligible effects are acknowledged

- **WHEN** the binding, state transition, milestone, and approved artifacts
  converge through the committed revision
- **THEN** status reports synchronized with no pending effects
- **AND** repeated status and sync do not duplicate comments or artifacts

#### Scenario: Doctor inspects disabled tracking with dormant state

- **WHEN** policy is absent or off while binding or pending files remain
- **THEN** Doctor reports any schema, path, digest, or safety fault locally
- **AND** files and provider state remain unchanged
