# External Ticket Tracking

## MODIFIED Requirements

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
