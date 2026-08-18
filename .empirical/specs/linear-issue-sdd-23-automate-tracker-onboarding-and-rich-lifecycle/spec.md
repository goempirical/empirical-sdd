# Linear Issue Sdd 23 Automate Tracker Onboarding And Rich Lifecycle

## Request

> Linear issue SDD-23 — Automate tracker onboarding and rich lifecycle synchronization.
>
> Problem: External tracking supports Linear, GitHub, and Jira, but onboarding and synchronization are too manual. empirical-init does not configure tracking; Tracker Policy v1 requires raw target IDs and a complete seven-state map; creating/attaching a ticket is separate; Linear sync rewrites an Empirical-owned description block rather than publishing milestone history; evidence artifacts are not projected.
>
> Goal: Add provider-aware setup completed before feature work begins. Initialization discovers valid targets and workflow states, proposes an editable semantic mapping, and configures automatic ticket behavior. Once enabled, Empirical ensures one ticket per feature, synchronizes meaningful progress, and attaches safe evidence artifacts.
>
> Requirements:
> - Guided tracker setup: Tracker init/config section with explicit disabled/local-only; credential source without secrets; discover workspaces/teams/projects/issue types/fields/states; validate before save; preview effective config; preserve tracker config during repair unless explicitly changed; equivalent non-interactive and MCP setup.
> - Provider-agnostic normalized mapping: specification, planned, in-progress, verification, review, blocked, done. Linear suggestions use state type and position primarily, names only as refinements; multiple phases may share a provider state; ambiguity requires explicit choice; common adapter discovery contract for Linear/GitHub Projects/Jira.
> - Ticket policy off/manual/ensure. Ensure attaches a valid reference or reconciles stable marker; creates only absent a unique valid ticket; durable pending/idempotency; ambiguity stops for reconciliation.
> - Visibility blockers/final only, phase milestones, or every committed revision. Idempotent comments/activities preserving user content; include phase, revision, completion, summary, blockers, artifacts; upload approved repo-contained screenshots/evidence where supported, else safe durable links; dedupe feature/revision/receipt digest; local state authoritative and committed before projection.
> - Backward compatible Tracker Policy v1 and disabled tracking makes no network calls.
> - Tests cover discovery, permissions, ambiguity, creation/recovery, comments, artifacts, outages.
> - Document setup, credentials, migration, recovery.

## Goal

Make optional ticket tracking a complete, provider-aware part of repository
setup and the normal feature lifecycle. A developer can select an accessible
target by name, review and edit a suggested seven-phase semantic mapping, and
choose automatic binding and progress visibility without copying opaque
identifiers or storing credentials. Once enabled, Empirical locally commits
workflow progress first, owns exactly one ticket association per feature, and
adds idempotent milestone history and safe evidence without overwriting human
content.

## Acceptance Criteria

- [ ] [AC-1] Interactive `empirical-init` and repair display a Tracker section
  with explicit local-only and Linear, GitHub Projects, and Jira choices;
  provider setup discovers accessible target hierarchy and workflow metadata,
  validates the selected target with the configured credential environment
  variable, previews the complete effective policy, and never persists a
  credential value.
- [ ] [AC-2] Non-interactive core/MCP configuration exposes the same discovery,
  suggestion, validation, preview, and apply contract as interactive Init,
  including deterministic identifiers suitable for automation and strict
  runtime-discriminated provider inputs.
- [ ] [AC-3] Repair preserves an existing Tracker Policy v1 or v2 byte-for-byte
  unless the caller explicitly submits a tracker change; choosing disabled
  removes only active policy and all tracker-disabled setup, workflow, status,
  and Doctor paths make zero provider requests.
- [ ] [AC-4] Discovery uses one provider-agnostic result shape for workspaces,
  teams/repositories/projects, issue types, status fields, and states, while
  retaining provider capabilities and target relationships needed to reject an
  inaccessible or mismatched selection before policy persistence.
- [ ] [AC-5] Mapping always covers `specification`, `planned`, `in-progress`,
  `verification`, `review`, `blocked`, and `done`; multiple phases may share a
  provider state, but no mapping is saved while a phase has zero or multiple
  equally ranked suggestions without an explicit caller selection.
- [ ] [AC-6] Linear suggestions rank workflow-state type and position before
  normalized name refinements, produce deterministic suggestions for ordinary
  Todo/In Progress/QA/Done boards, and surface rather than guess every tied or
  semantically incompatible candidate.
- [ ] [AC-7] Tracker Policy v2 configures ticket behavior as `off`, `manual`, or
  `ensure` and progress visibility as `blockers-final`, `milestones`, or
  `revisions`; existing Tracker Policy v1 files load with manual binding and
  legacy state-projection behavior until deliberately upgraded.
- [ ] [AC-8] In `ensure` mode, a feature operation first validates a referenced
  ticket, then reconciles the feature's stable Empirical marker, and creates
  only when neither yields one unique target-valid ticket; one match binds,
  multiple matches preserve durable reconciliation state and fail closed.
- [ ] [AC-9] Create intent and dispatch state are committed before network
  effects, interrupted retries reconcile the exact stable marker without
  silently resending a dispatched create, and successful recovery cannot bind
  or create more than one ticket for a feature.
- [ ] [AC-10] Eligible committed progress creates idempotent provider comments
  or activities containing feature, phase, revision, completion level, concise
  summary, blockers, and reviewable artifacts; visibility policy filters which
  revisions publish and deduplication keys include feature, revision, and the
  sorted receipt digest.
- [ ] [AC-11] Synchronization never rewrites a Linear issue description to show
  progress and preserves all user-authored descriptions; legacy managed blocks
  remain readable/recoverable for compatibility while new lifecycle history is
  append-only through comments or activities.
- [ ] [AC-12] Approved evidence paths are resolved inside the repository,
  restricted to recorded receipt artifacts and safe media/size bounds, uploaded
  where the provider adapter advertises upload support, and otherwise rendered
  as safe durable links; unsafe, missing, symlink-escaping, secret-like, or
  unsupported artifacts are omitted with bounded diagnostics.
- [ ] [AC-13] Provider permission denial, malformed discovery, incomplete
  pagination, timeout, upload failure, comment failure, and outage leave the
  committed local revision authoritative and retain reconstructable,
  credential-free pending work for an exact retry.
- [ ] [AC-14] Automated tests cover all three adapters' discovery contract,
  target permission validation, Linear mapping and ambiguity, policy v1
  compatibility, disabled no-network behavior, ensure attach/create/recovery,
  comment and artifact deduplication, description preservation, and provider
  outage recovery.
- [ ] [AC-15] User documentation explains interactive and non-interactive
  setup, credential environment variables and required permissions, Policy v1
  compatibility/migration, automatic ticket behavior, progress/evidence safety,
  ambiguity handling, and recovery from interrupted or failed projections.

## Scope

- Tracker Policy v2 schema, validation, effective-policy preview, and explicit
  Policy v1 compatibility parsing.
- A provider-neutral discovery/suggestion/validation adapter contract with
  Linear, GitHub Projects, and Jira implementations.
- Tracker setup in interactive Init plus equivalent core and MCP operations.
- Automatic binding orchestration and durable create-marker reconciliation.
- Visibility-filtered milestone comments/activities and safe evidence
  projection with durable idempotency acknowledgements.
- Status, Doctor, public types/schemas, docs, and tests needed to operate and
  recover these behaviors.

## Non-goals

- Importing remote issue edits, status, comments, or attachments into the local
  Empirical journal, or treating the tracker as workflow authority.
- Persisting, provisioning, refreshing, or testing credential values outside
  the host runtime environment.
- Automatically selecting between ambiguous targets or workflow states.
- Mirroring arbitrary repository files or retroactively uploading artifacts
  that were not approved by an immutable evidence receipt.
- Guaranteeing binary upload on providers whose supported API/capabilities do
  not offer it; safe links or omission with diagnostics are acceptable.
- Replacing project-management features such as assignees, labels, sprints,
  estimates, dependencies, or bidirectional issue editing.
- Publishing, delivering, or changing external tracker data when tracking is
  disabled.

## Risks and failure boundaries

- A lost create response can produce duplicate tickets unless dispatched intent
  is reconciled through one stable marker; retry therefore fails closed on zero,
  multiple, malformed, or incompletely paginated matches.
- Provider metadata is mutable. Applied policies bind canonical target and
  state identities plus a validated policy digest; drift is observable and
  cannot silently retarget an existing binding.
- State-name heuristics vary by language and board design. Provider semantics
  and ordering outrank names, tied scores are ambiguity, and every applied
  mapping remains editable and visible.
- Comments and uploads are separate remote effects. Pending projection records
  acknowledge each exact effect so partial success retries only missing work.
- Evidence may expose repository content. Only receipt-approved, contained,
  regular files with safe media, size, path, and link handling cross the remote
  boundary; durable errors redact runtime credentials.
- Repair and migration can accidentally enroll dormant repositories. Existing
  policy is preserved without provider access until an explicit tracker change
  or eligible synchronization is requested.

## Verification

- Run focused tracker, setup, MCP, CLI config, Doctor, migration, and consistency
  tests with injectable transports that count calls and simulate pagination,
  permissions, malformed payloads, timeouts, and interrupted effects.
- Exercise table-driven Linear state sets including Todo/In Progress/QA/Review/
  Done, simple three-state boards with shared mappings, localized names, and
  tied same-type/same-position candidates.
- Prove ensure idempotency by interrupting before dispatch, after dispatch, after
  ticket creation, after comment creation, and after artifact upload, then
  retrying from persisted state and asserting one binding and one remote effect
  per idempotency key.
- Assert byte preservation of user-authored Linear descriptions and existing
  tracker policy during repair, and assert zero transport calls in disabled
  setup/status/Doctor/workflow paths.
- Run type checking, full tests, distribution smoke, package inspection,
  consistency checks, and `git diff --check` through the repository's configured
  evidence commands.

## Capability Deltas

- `external-ticket-tracking`: guided discovery and semantic mapping, Tracker
  Policy v2 compatibility, ensure binding, milestone comments, evidence
  projection, and recoverable provider failures.
