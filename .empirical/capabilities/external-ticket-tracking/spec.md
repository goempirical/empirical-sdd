# External Ticket Tracking Specification

## Purpose

Mirror authoritative Empirical progress to one optional external ticket without
allowing remote availability or state to weaken the local SDD protocol.

## Requirements

### Requirement: Tracking is optional and one-way

Empirical SHALL recommend `ensure` tracking for all feature work during first
setup, but MUST require the user to choose between Track all work and No
tracking before initialization mutates the repository. No tracking remains a
fully supported provider-free mode and MUST perform no provider request.
Tracker Policy v2 SHALL choose ticket behavior `off`, `manual`, or `ensure` and
progress visibility `blockers-final`, `milestones`, or `revisions`. Policy v1
MUST remain readable with its existing explicit/manual binding and legacy
projection behavior. Remote data is projection input only for validating a
referenced identity or reconciling an exact Empirical-owned marker; it MUST NOT
mutate, advance, pause, retry, reroute, or complete local workflow state.

#### Scenario: A new repository chooses the recommendation

- **WHEN** Init finds no prior tracker policy or explicit opt-out
- **THEN** Track all work is presented as the recommended choice
- **AND** saving that choice requires an approved provider policy whose ticket
  behavior is `ensure`

#### Scenario: A new repository declines tracking

- **WHEN** the user explicitly chooses No tracking
- **THEN** Init persists a provider-free disabled setup record
- **AND** no provider discovery, binding, synchronization, or ticket creation
  occurs

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
and publish one append-only, idempotent comment or activity derived from the
committed feature, phase, status, revision, highest completion level, concise
summary, bounded blocker, receipt identity, and reviewable artifacts.

The visible comment SHALL be human-first: its primary hierarchy MUST use a
plain-language state headline, human-readable work label, concise committed
summary, and only event-relevant action or evidence. Awaiting-human and blocked
states MUST be visibly distinct, and completion wording MUST NOT claim a level
above the committed local completion report. Raw feature slugs, revisions,
completion fields, receipt identifiers, artifact paths without useful links,
digests, duplicate marker labels, and provider implementation diagnostics MUST
NOT appear as visible status prose.

GitHub and Linear SHALL serialize the shared human semantics as safe bounded
Markdown, while Jira SHALL use structured ADF dedicated to milestone comments.
Each provider MUST retain the exact effect marker in a provider-appropriate,
non-distracting machine-owned representation. Untrusted feature labels,
summaries, blockers, artifact labels, and URLs MUST be length-bounded and
escaped so they cannot inject structure, mentions, or alternate markers. A
validated durable evidence URL SHALL use a friendly link label; unavailable or
provider-native upload evidence MUST remain truthful through artifact effects
and tracker health without exposing raw paths, receipts, or unsupported-state
prose in the comment.

New lifecycle synchronization MUST NOT rewrite Linear descriptions or any
user-authored description content. Existing Policy v1 projections, old
milestone comments, managed descriptions, and recovery markers remain readable
for compatibility and reconciliation. A lost response MUST reconcile either the
current or legacy exact milestone marker without publishing a second comment;
ambiguous or malformed ownership MUST fail closed with durable safe health.
Visibility cadence, transition-before-comment ordering, ticket identity, state
mapping, artifact eligibility/upload behavior, and acknowledgement identity
remain unchanged.

#### Scenario: Ordinary milestone is readable at a glance

- **WHEN** an eligible non-blocked progress revision is synchronized
- **THEN** the comment leads with a plain-language state, human-readable work
  label, and concise committed summary
- **AND** raw revision, completion, digest, receipt, and feature-slug fields do
  not appear as visible status prose

#### Scenario: Human input is required

- **WHEN** the committed status is `awaiting_human`
- **THEN** the comment visibly asks for input and presents the bounded gate
- **AND** it does not describe the feature as blocked by an implementation
  failure or claim a higher completion level

#### Scenario: Work is blocked

- **WHEN** the committed status is `blocked`
- **THEN** the comment visibly identifies the work as blocked and presents the
  concise blocker
- **AND** tracker health remains the authoritative source for retryable remote
  effect failures

#### Scenario: Completion language remains truthful

- **WHEN** a final projection has a highest completion level from implemented
  through published
- **THEN** the human headline reflects no level above that exact proof
- **AND** delivered and published are not used for merely implemented,
  verified, or integrated work

#### Scenario: Reviewable evidence has a durable URL

- **WHEN** an approved artifact carries a validated safe durable URL
- **THEN** the milestone presents a friendly evidence link
- **AND** it omits the raw receipt identifier and repository path

#### Scenario: Evidence has no comment-safe URL

- **WHEN** approved evidence awaits provider-native upload or has no safe
  durable link
- **THEN** the milestone does not expose paths, receipt ids, or
  pending/unsupported diagnostics
- **AND** the independent artifact effect and tracker health continue to report
  the truthful synchronization state

#### Scenario: Provider representations preserve exact ownership

- **WHEN** GitHub, Linear, and Jira serialize the same eligible projection
- **THEN** each renders the same human meaning in its native safe format
- **AND** each retains the exact effect marker without displaying its digest as
  ordinary prose

#### Scenario: A lost response finds a legacy comment

- **WHEN** synchronization cannot observe a response and the provider contains
  exactly one old-format comment with the expected marker
- **THEN** retry acknowledges that existing effect without publishing again
- **AND** multiple, malformed, or incomplete matches fail closed

#### Scenario: Milestone visibility skips same-phase churn

- **WHEN** a committed revision does not change phase, stop condition, or final
  completion under `milestones`
- **THEN** no milestone comment or activity is created for that revision
- **AND** later eligible progress remains projectable

#### Scenario: A ticket has a user-authored description

- **WHEN** state and milestone progress are synchronized
- **THEN** the description remains byte-for-byte unchanged
- **AND** the new human-first progress record appears as a separate idempotent
  comment

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

### Requirement: Tracker setup is guided, previewable, and explicit

Initialization and repair SHALL inspect the durable tracker setup state before
mutation. When no decision exists, the Tracker section MUST show Track all work
as recommended and No tracking as an explicit alternative, and Apply/Keep or
Customize MUST NOT bypass that choice. Track all SHALL use the selected Linear,
GitHub Projects, or Jira adapter to discover and validate accessible target
metadata, preview all seven semantic phase mappings, and apply Tracker Policy
v2 with ticket behavior `ensure`. No tracking SHALL persist a strict
provider-free disabled record. Configuration MUST reference credential
environment-variable names only and persist neither credential values nor
provider responses containing authorization material. Repair MUST preserve an
existing policy or disabled record byte-for-byte without provider access unless
the caller explicitly changes it.

#### Scenario: Apply recommended settings reaches tracker onboarding

- **WHEN** a first-run user accepts the recommended Verification, Parallel work,
  and Decisions settings
- **THEN** Init still asks Track all work or No tracking before Save
- **AND** no repository file exists until the complete effective summary is
  approved

#### Scenario: Interactive provider setup tracks all work

- **WHEN** a developer selects a provider, runtime credential source, target,
  reviewed state mapping, and progress visibility from discovered choices
- **THEN** Init validates and previews the exact secret-free policy with ticket
  behavior `ensure`
- **AND** only approved identifiers and credential variable names are persisted

#### Scenario: Repair preserves an explicit opt-out

- **WHEN** an initialized repository contains the valid disabled setup record
- **THEN** No tracking is displayed as current and Preserve is the default
- **AND** repair changes no tracker bytes and makes no provider request

#### Scenario: Repair finds no prior decision

- **WHEN** repository configuration exists but neither a tracker policy nor a
  disabled setup record exists
- **THEN** repair asks the same Track all work or No tracking question as first
  setup
- **AND** it cannot infer local-only from absence

#### Scenario: Setup is cancelled

- **WHEN** the user cancels before the final effective summary is saved
- **THEN** Init writes no configuration, disabled record, provider policy, or
  workflow state
- **AND** no provider request or remote ticket effect occurs after cancellation

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

### Requirement: Canonical checkout aliases preserve evidence eligibility

Empirical MUST compare both an approved artifact and its resolved regular-file
target against the same canonical repository root. A lexical checkout alias,
including an operating-system temporary-directory alias or an explicitly
symlinked repository root, MUST NOT by itself make a repository-contained
artifact ineligible. Direct traversal and symbolic-link targets outside the
canonical repository MUST continue to fail before any provider request.

#### Scenario: A repository root has a lexical alias

- **GIVEN** a receipt-approved regular artifact within the canonical repository
- **WHEN** tracker projection is invoked through a repository-root path that
  canonicalizes to a different absolute path
- **THEN** Empirical evaluates and projects the artifact from the canonical root
- **AND** the lexical alias is not reported as a repository escape

#### Scenario: An artifact link escapes the canonical repository

- **WHEN** a receipt path names a symbolic link or resolves to a target outside
  the canonical repository
- **THEN** Empirical rejects the artifact before provider access
- **AND** no canonical-root alias weakens the existing fail-closed boundary
