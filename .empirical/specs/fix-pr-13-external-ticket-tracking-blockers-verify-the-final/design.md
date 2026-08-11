# Design: PR #13 External Ticket Tracking Hardening

## System boundary

Empirical remains the authoritative local workflow. External tickets are
outbound projections reached only through explicit configure, bind, and sync
operations. Policy stores credential environment-variable names, never values;
the host injects a value only for the duration of a provider call.

The implementation is divided into four boundaries:

1. CLI and MCP parse strict policy and mode-discriminated bind inputs before a
   project is opened or tracker state can change.
2. `tracking.ts` owns durable binding and pending records, provider dispatch,
   reconciliation, projection, redaction, and local status.
3. Provider adapters validate target membership, remote identity, URLs,
   pagination, warnings, response bounds, and exact Empirical-owned markers.
4. Doctor reads and validates tracker records without locks, writes, repair, or
   provider traffic, even when tracker policy is absent.

## Durable bind state machine

A create or attach attempt is represented by a checksummed pending record bound
to the feature, provider target digest, projection-policy digest, and stable
attempt key. Create intent also stores normalized title and description, an
exact logical marker, and a `dispatched` flag.

Create transitions are:

1. Persist `prepared` intent with `dispatched=false`.
2. Resolve the runtime credential, then persist `dispatched=true` immediately
   before the provider request.
3. On a validated create response, persist the target-bound binding before
   projecting workflow state.
4. On any unconfirmed post-dispatch result, retain the attempt and report
   `TRACKER_CREATE_AMBIGUOUS`.
5. Recovery performs only a bounded exact-marker lookup. One target-valid match
   establishes the binding; zero, multiple, malformed, warned, or incompletely
   paginated results fail closed. An explicitly confirmed new create mints a
   new attempt key and surfaces duplicate risk.

Attach intent is also durable. Sync retries the exact ticket after credentials
or availability return. When attach resolves an ambiguous create, the selected
ticket must contain the original marker and match the original target; success
retains the attempt identity, while failure preserves the evidence. Replacement
records associate the old binding digest with the new attempt so a failed
replacement cannot accidentally project or acknowledge the old ticket.

## Binding and projection invariants

A binding pins provider, target digest, bind-attempt key, validated remote
identity, credential-free URL, and synchronization acknowledgments. Before
reuse, status and sync validate its digest, feature, provider, target, identity,
and URL. Target drift fails before network access. Projection acknowledgment
includes the effective target and state-mapping digest, so changing a mapping
forces reprojection even when the local revision is unchanged.

Binding persistence and state projection are separate failure stages. Once a
create returns a valid identity, the binding is durable; a later comment,
property, project-item, or state failure is an ordinary retryable projection
failure, not an ambiguous create.

## Provider reconciliation

- GitHub scans bounded issue pages, excludes pull requests, requires complete
  pagination, validates the configured repository and issue, re-derives the
  Projects v2 item and exact owned comment on every mutation, and never trusts
  persisted opaque mutation identifiers.
- Linear searches within the configured team, checks optional project
  membership and exact marker ownership, requires complete Relay pagination,
  preserves human description text outside one balanced owned block, and
  accepts validated provider URLs up to the response URL bound.
- Jira uses enhanced JQL confined to the configured project, validates issue
  type and exact issue property, fails closed on warnings or incomplete
  pagination, and writes provider-valid ADF descriptions.

All adapters use the same size- and timeout-bounded transport contract. Runtime
credential values are redacted from provider and injected-transport errors
before bounded diagnostics can be persisted or rendered.

## Public surfaces and diagnostics

CLI and MCP share the core policy and bind schemas. MCP advertises strict policy
alternatives and distinct create/attach branches, while configure, bind, and
sync metadata declares mutation. Human status/action output shows safe health,
provider, URL, committed/last-synced/pending revisions, bounded failure facts,
and recovery guidance. Unsafe or off-target URLs are suppressed.

Doctor uses read-only record inspection and reports dormant malformed binding
or pending files without changing file bytes or Git state.

## Verification and live demonstration

Focused tests cover every state transition, malformed response, target escape,
forged identifier, pagination edge, redaction boundary, public schema, and
Doctor invariant. `bun run ci` provides the complete immutable test/review
receipt.

The live Linear fault-injection harness runs outside the repository and receives
only a newly supplied short-lived secret. It allows the real `issueCreate` call
to succeed, discards that response locally, asserts durable ambiguity, then
syncs through exact-marker reconciliation and proves there was one create and
one marker. It updates mapping and completion on the same issue, archives the
disposable test issue, confirms archival, and emits a sanitized result artifact.
The dotenv file and harness are deleted afterward. A separate clearly named
demo issue may be created with the normal path and left visible at the user's
request; its safe URL and key are the only remote identifiers reported.

