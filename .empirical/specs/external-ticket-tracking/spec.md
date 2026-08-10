# External Ticket Tracking

## Request

> Add optional external ticket-board tracking to Empirical. Empirical remains
> authoritative, while GitHub, Linear, and Jira are one-way mirrors. Reduce the
> human workflow surface to the single `$empirical` skill; retain granular MCP
> operations as private machine-facing capabilities used by that skill.

## Goal

A developer can configure one optional external board, create or attach one
ticket to an Empirical feature, and then let `$empirical` advance the ticket as
the exact SDD state changes. Local workflow transitions remain safe and usable
when the provider is absent, slow, misconfigured, or unavailable. A developer
installs and invokes only one Empirical skill; the skill drives setup,
discovery, routing, execution, evidence, retries, and tracker synchronization
through granular MCP operations.

## Acceptance Criteria

- [ ] [AC-1] A project with no tracker configuration behaves as local-only,
  performs no tracker network request, and reports tracker health as
  `local-only`.
- [ ] [AC-2] Tracker configuration accepts exactly one of GitHub, Linear, or
  Jira with a provider-specific project target and a complete mapping from
  normalized Empirical progress states to provider-native state identifiers;
  malformed, ambiguous, or secret-bearing configuration is rejected before
  mutation.
- [ ] [AC-3] `$empirical` can create a provider ticket for the selected feature
  or attach the feature to one existing ticket, persists one provider/remote-id
  binding, and refuses an implicit replacement of an existing binding.
- [ ] [AC-4] Repository state persists no access token, password, cookie,
  authorization header, or other credential value; provider authentication is
  resolved only from documented environment variables at synchronization time.
- [ ] [AC-5] External tickets are one-way mirrors: remote ticket content or
  status can never start, complete, pause, retry, reroute, or otherwise mutate
  an Empirical workflow revision.
- [ ] [AC-6] Every local workflow mutation commits its exact journal event and
  state projection before any remote request is attempted; a remote failure
  cannot roll back, block, or misreport the committed local transition.
- [ ] [AC-7] A committed but unsynchronized revision is represented by durable,
  repository-contained, secret-free pending work with a stable idempotency key;
  interruption between commit and enqueue is detected and repaired from the
  authoritative state.
- [ ] [AC-8] Synchronization retries pending work deterministically, never
  duplicates a successful logical update, preserves bounded diagnostic data,
  and converges the binding to the latest committed revision after recovery.
- [ ] [AC-9] The tracker projection maps `specify`, `design`, `plan`,
  `implement`, `context`, `verify`, `review`, `integrate`, terminal completion,
  `blocked`, and `awaiting_human` through one documented normalized progress
  model and the project's explicit provider mapping.
- [ ] [AC-10] Each remote projection includes a stable Empirical marker plus the
  feature id, exact phase, workflow status, revision, highest completion level,
  and blocker or awaiting-human summary when present.
- [ ] [AC-11] Status and action packets expose tracker health as exactly
  `local-only`, `pending`, `synced`, or `failed`, including the bound provider,
  safe ticket URL, committed revision, last synchronized revision, and a
  credential-safe failure summary when applicable.
- [ ] [AC-12] The GitHub provider can create or attach an issue, project the
  Empirical marker/update, and move the configured project status through an
  injected HTTP transport with provider responses validated before persistence.
- [ ] [AC-13] The Linear provider can create or attach an issue, project the
  Empirical marker/update, and move the configured workflow state through the
  same provider-neutral contract with validated responses.
- [ ] [AC-14] The Jira provider can create or attach an issue, project the
  Empirical marker/update, and perform the configured transition through the
  same provider-neutral contract with validated responses.
- [ ] [AC-15] Provider tests use injected deterministic transports and cover
  success, authentication absence, rate/server failure, malformed response,
  retry, idempotency, redaction, and local-state survival without live external
  credentials or network access.
- [ ] [AC-16] The global skill registry contains only `empirical`; each selected
  supported agent receives exactly that one managed user-facing skill and all
  installation counts, labels, reports, and package checks derive from the
  registry.
- [ ] [AC-17] Installation, update, and uninstall remove marker-owned
  `empirical-init`, `empirical-spec`, `empirical-socratic`, `empirical-loop`,
  `empirical-yolo`, and older dedicated entrypoints repeatably while preserving
  unmanaged collisions and unrelated user configuration.
- [ ] [AC-18] The one generated `$empirical` contract owns initialization,
  discovery, routing, normal and bounded-autonomy execution, handoff, tracker
  configuration/synchronization, and terminal reporting through MCP-first
  granular operations; normal help and documentation expose no additional
  human workflow skill.
- [ ] [AC-19] Existing Schema-5 projects and features open without migration
  prompts as local-only, independently versioned tracker files validate
  strictly, package exports remain narrow, and type checking, tests,
  distribution smoke, package inspection, consistency checks, coverage gates,
  and `git diff --check` pass.

## Scope

- A provider-neutral tracker domain and injectable HTTP transport.
- GitHub, Linear, and Jira create/attach/update implementations.
- Independently versioned project tracker configuration, per-feature binding,
  durable pending projections, retry/convergence, and safe diagnostics.
- Normalized phase/status mapping and tracker health in structured and human
  status/action output.
- Granular tracker MCP operations for configure, bind, and synchronize, driven
  by the sole generated `$empirical` skill.
- Registry-backed installation, upgrade, cleanup, documentation, distribution,
  and tests for exactly one user-facing skill.

## Non-goals

- Reading remote status or content into Empirical, bidirectional conflict
  resolution, webhooks, polling daemons, or treating a board as authoritative.
- Managing arbitrary board schemas, creating projects/workflows, discovering
  provider state names implicitly, or replacing explicit mapping choices.
- Persisting provider credentials, installing provider-specific agent plugins,
  or requiring a live provider during repository CI.
- Mirroring more than one ticket per feature or more than one provider per
  project in this version.
- Changing evidence, review, integration, delivery, publication, or host
  authorization safety floors.

## Risks

- A remote side effect can succeed while its response is lost. Stable
  idempotency markers and convergence reads/updates must prevent duplicates.
- Provider APIs and status models differ. The shared contract must normalize
  Empirical intent without pretending provider identifiers are interchangeable.
- Diagnostic bodies can echo credentials or private ticket content. All stored
  errors must be bounded and redacted.
- Terminal journal compaction can remove intermediate events. Pending tracker
  projections must remain durable independently until acknowledged.
- Removing dedicated skills can delete user content if ownership checks are
  weak. Cleanup remains marker- and containment-bound.

## Verification

- Unit-test strict tracker schemas, normalized projections, idempotency keys,
  redaction, and phase/status mapping.
- Exercise all providers with injected request/response fixtures, including
  create, attach, update, transition, retry, and malformed responses.
- Exercise a committed workflow transition whose provider fails and prove the
  revision remains advanced while tracker health becomes pending/failed.
- Exercise crash-gap repair, retry convergence, terminal completion, and
  repeated synchronization without duplicate logical updates.
- Exercise install/update/uninstall against managed and unmanaged skill roots
  and assert exactly one registered skill and all obsolete cleanup paths.
- Run the configured `ci` evidence command against AC-1 through AC-19.

## Capability Deltas

- `deltas/external-ticket-tracking.md` adds the provider-neutral one-way mirror.
- `deltas/agent-integrations.md` contracts the human skill surface to one.
- `deltas/project-policy.md` adds safe committed tracker configuration.
