# Design: Tracker Onboarding and Rich Lifecycle Synchronization

## Overview

Extend the existing `src/tracking.ts` boundary rather than create a second
integration subsystem. Tracker Policy v2 adds behavior and visibility choices;
v1 remains a valid persisted input and is normalized in memory to a conservative
effective policy. A common adapter surface supplies discovery, target
validation, marker reconciliation, state transition, milestone publication, and
artifact capabilities for Linear, GitHub Projects, and Jira.

Repository setup gains an optional tracker change alongside ordinary project
configuration. No tracker field means preserve the current sidecar exactly;
`disabled` means remove active policy; a provider setup is discovered,
previewed, validated, and then applied. This distinction prevents routine repair
from silently enrolling, migrating, or contacting a tracker.

## Policy and public data model

Keep `TRACKER_SCHEMA_VERSION` as the newest version (`2`) and accept a strict
union of v1 and v2 policies:

```text
Tracker Policy v1
  provider + target + credentialEnv + seven states
  effective behavior: manual
  effective visibility/projection: legacy state projection

Tracker Policy v2
  provider + target + credentialEnv + seven states
  ticket: off | manual | ensure
  visibility: blockers-final | milestones | revisions
```

The provider branches keep their existing target and credential shapes, so v1
files need no rewrite. `effectiveTrackerPolicy()` supplies defaults to runtime
logic and computes target/projection digests from behavioral fields as well as
the existing target and mapping. Status and setup preview expose schema version,
ticket behavior, visibility, and whether compatibility defaults are active.

New public strict inputs and outputs are:

- `TrackerDiscoveryInput`: provider plus credential environment-variable names.
  It may include a bounded provider scope such as Jira site URL, but no opaque
  target identifiers are required to begin discovery.
- `TrackerDiscovery`: provider-neutral `resources[]`, each with kind, canonical
  ID, display name, parent IDs, position/semantic metadata, and capabilities;
  plus pagination-complete and validation facts.
- `TrackerMappingSuggestion`: seven entries containing ranked candidates,
  reasons, confidence (`suggested` or `ambiguous`), and an optional selected ID.
- `TrackerPolicyPreview`: the exact secret-free policy, display-name expansion,
  mapping report, permission/target validation, compatibility facts, and a
  canonical digest. Preview does not write repository state.
- `TrackerSetupChange`: `preserve`, `disabled`, or `apply` with a strict v2
  policy. `preserve` is the Init/repair default and is not encoded as policy.

## Discovery and mapping

Each adapter implements one discovery contract over the existing injectable,
bounded transport. Provider-specific traversal is explicit:

- Linear queries viewer organization/workspace, teams, team projects, and
  workflow states including `type`, `position`, and team ownership.
- GitHub queries viewer-accessible organizations/repositories, Projects v2,
  single-select status fields, and their options.
- Jira starts from an explicit safe site URL and queries accessible projects,
  issue types, status fields/workflows, and statuses.

Every page validates its envelope, canonical IDs, parent relationships, URLs,
cursor progress, count, and response bounds. A repeated cursor, malformed
success payload, or incomplete traversal invalidates the whole discovery. Raw
catalogs are returned only to the caller and are never persisted.

The mapping engine is pure and provider-neutral after adapters classify state
semantics. Each normalized phase defines compatible semantic buckets and a
target lifecycle position. Candidates are ranked lexicographically by:

1. provider semantic/type compatibility;
2. distance from the normalized lifecycle position;
3. compatible normalized-name refinement.

Linear `type` and `position` therefore decide the primary rank. Names may
refine compatible candidates but never repair a type mismatch or select between
candidates tied on the primary rank. Equal best primary rank is returned as
ambiguous. Callers may explicitly choose any discovered target-valid state,
including reusing one state for several phases. Preview refuses missing,
unknown, or unresolved ambiguous selections.

## Setup flow

Add `tracker-discover` and `tracker-preview` registry/MCP operations and extend
`tracker-configure` to accept validated v2 policies. The TypeScript API exposes
the same functions. MCP schemas remain strict provider-discriminated unions;
all three surfaces resolve credentials from the supplied environment-variable
names only at call time.

Interactive Init renders a Tracker section after verification/isolation/
decision settings:

1. Existing policy: Preserve (default), Change, or Disable. New repository:
   Local-only (default), Linear, GitHub Projects, or Jira.
2. Provider selection asks for credential variable names, runs discovery, and
   renders selectable resources by display name with canonical ID as secondary
   text.
3. The mapping table shows all seven phases, suggestions, shared mappings, and
   ambiguity. Explicit edits are collected until preview validation passes.
4. Ticket behavior and progress visibility are selected.
5. The complete effective configuration, including provider display names but
   no credential values, is shown before final Save.

The non-interactive `init` and `configure` MCP methods gain an optional strict
tracker change. Absence means preserve. An apply request repeats discovery and
validation immediately before the atomic policy write, preventing stale or
forged preview data from bypassing access checks. Disabled removes only
`.empirical/tracker.json`; dormant per-feature records remain inspectable and
recoverable if the policy is restored.

## Ensure binding

Keep the current binding and pending files and generalize pending intent into an
effect ledger. The stable feature marker is target-bound and independent from a
single attempt; create attempts retain their separate idempotency key and
dispatched flag.

When ticket behavior is `ensure` and an eligible feature sync has no valid
binding:

1. If a caller-supplied or durable feature reference exists, validate it against
   the exact configured target. One valid reference binds; an invalid reference
   is reported and marker reconciliation continues only when it cannot denote a
   competing valid ticket.
2. Search the configured target for the exact stable feature marker with bounded
   complete pagination. One match binds. Multiple matches or incomplete data
   stores `TRACKER_BIND_AMBIGUOUS` and stops.
3. With zero matches, persist undispatched create intent; persist `dispatched`
   immediately before the create request; validate and bind the response.
4. If the response is lost, every retry reconciles the marker. It never resends
   that dispatched attempt. Zero or multiple results remain an explicit
   reconciliation stop, preserving the current duplicate-risk recovery path.

`manual` retains explicit create/attach semantics. `off` returns without
credentials or network access even when bindings or pending files exist.

## Milestones, comments, and artifacts

`TrackerProjection` v2 adds the committed workflow summary, blocker text,
receipt IDs, sorted receipt digest, and reviewable artifact descriptors. The
projection is built only from the committed state and immutable receipt files.
Visibility eligibility compares the committed projection with the last
acknowledged one:

- `blockers-final`: blocked/awaiting-human transitions and final Done only;
- `milestones`: phase, stop-condition, or final completion changes;
- `revisions`: every new committed revision.

The pending effect ledger lists deterministic effects: binding, state
transition, milestone comment/activity, and each artifact. An effect key hashes
provider target, feature, revision, sorted receipt digest, effect kind, and
artifact digest when applicable. Adapters receive the key as their native
idempotency marker where possible and reconciliation checks exact markers before
retry. Each successful effect is acknowledged atomically; partial retry skips
acknowledged effects.

Milestone Markdown is compact and provider-neutral: phase, revision, completion
level, committed summary, bounded blockers, and artifact labels/links. Linear
uses issue comments (`commentCreate`), GitHub uses issue comments, and Jira uses
issue comments/properties. New synchronization does not update Linear or Jira
descriptions. Existing v1 managed description markers remain parseable only for
compatibility, attachment validation, and recovery.

Artifact collection accepts only paths and digests already present in validated
immutable evidence receipts. Before projection it resolves each path from the
repository root, rejects symlinks/non-regular files/escapes and secret-like
names, verifies the receipt digest and current file digest, permits a small
document/image media allowlist, and enforces per-file/count/total-byte bounds.
Adapter capabilities choose native upload, durable repository/provider link, or
a bounded unsupported diagnostic. No base64/blob or credential value is stored
in pending state.

## Adapter changes

Extend the internal adapter dispatch with these logical methods:

```text
discover(input) -> TrackerDiscovery
validate(policy, discovery) -> validated target
findByFeatureMarker(policy, marker) -> complete candidate set
create(policy, projection, marker, attempt) -> RemoteTicket
attach/reference(policy, identity) -> RemoteTicket
transition(policy, ticket, state, effectKey)
comment(policy, ticket, milestone, effectKey)
artifactCapabilities(policy)
uploadOrLink(policy, ticket, artifact, effectKey)
```

All methods use the existing timeout/size-bounded `TrackerTransport`, credential
redaction, safe URL validation, and provider target assertions. Linear preserves
descriptions by limiting mutations to state and comments. GitHub validates
repository/project membership before comments or status updates. Jira validates
site/project/issue type and uses exact issue properties for markers and effect
receipts.

## Storage and compatibility

- Policy v1 parsing and current v1 binding/pending schemas remain accepted.
- New binding/pending records use schema version 2 and include effective policy,
  last acknowledged projection metadata, effect acknowledgements, and bounded
  ambiguity facts. Loaders normalize valid v1 records without rewriting them;
  the next explicit eligible mutation writes v2.
- Policy configuration remains atomic and symbolic-link aware. V2 apply performs
  remote validation before the write; failures leave prior bytes untouched.
- Target digest remains independent from mapping/behavior, while projection
  policy digest includes states, ticket behavior, visibility, and schema
  compatibility mode. Same-target changes therefore reproject without allowing
  an old binding to cross targets.
- Status and Doctor parse and validate both versions locally. They never invoke
  discovery or provider APIs.

## Failure handling

- Missing credential/permission, outage, timeout, malformed envelopes, unsafe
  URLs, pagination faults, and target drift produce bounded redacted failures.
- Mapping ambiguity blocks preview/application before policy mutation.
- Binding ambiguity and unknown dispatched create outcome remain durable and do
  not authorize another create.
- Comment/upload partial failure preserves binding and state acknowledgements;
  retry resumes only unacknowledged effect keys.
- Unsafe artifacts never cross the network boundary. A required eligible effect
  remains failed/pending; an explicitly unsupported optional artifact is noted
  in the milestone and acknowledged as omitted according to provider capability.
- Disabled/off paths branch before credential resolution and adapter creation.

## Verification mapping

- AC-1–AC-4: setup/CLI/MCP tests for preserve, disable, discovered selection,
  permission validation, preview equivalence, strict schemas, and zero-network
  disabled behavior across all adapters.
- AC-5–AC-6: pure table-driven mapping tests for conventional, simple, localized,
  incompatible, shared, and tied Linear workflows plus generic adapter output.
- AC-7: v1 policy/binding/pending fixtures and explicit v2 apply/migration tests.
- AC-8–AC-9: ensure tests interrupted before dispatch, after dispatch, after
  provider create, and through zero/one/multiple/incomplete reconciliation.
- AC-10–AC-13: visibility tables, exact milestone content, description-byte
  preservation, comment/upload effect acknowledgement, artifact containment,
  provider outage, and credential-redaction tests.
- AC-14–AC-15: focused suites plus full CI, distribution smoke, consistency,
  package inspection, and updated setup/MCP/protocol/security documentation.
