# Empirical protocol 0.24

## Shared contract

Schema 5 uses strict runtime schemas from `empirical-sdd/protocol`. CLI, MCP,
skills, storage, and the TypeScript API share the same workflow, phase, risk,
receipt, authorization, impact, policy, and completion definitions. Canonical
JSON and prefixed SHA-256 digests make durable documents independently
verifiable.

Every current action is an `ActionPacket` bound to one feature and exact
revision. Its essential fields are:

```json
{
  "kind": "action",
  "protocol": "empirical-sdd",
  "schemaVersion": 5,
  "feature": "add-team-invitations",
  "profile": "complex",
  "mode": "normal",
  "riskFloor": "behavioral",
  "phase": "verify",
  "status": "waiting",
  "revision": 5,
  "completionLevel": { "highest": "implemented" },
  "tracker": {
    "health": "synced",
    "provider": "linear",
    "url": "https://linear.app/example/issue/ENG-42",
    "committedRevision": 5,
    "lastSyncedRevision": 5,
    "pendingRevision": null,
    "failure": null
  },
  "completion": {
    "available": true,
    "mcpTool": "empirical_complete",
    "requiredFields": ["revision", "outcome", "summary", "receiptIds"]
  }
}
```

All mutations require the exact revision. A stale caller receives
`STALE_REVISION`; it cannot overwrite newer state.

## Routing and modes

Routing calculates the strongest matching floor:

```text
contract-neutral < behavioral < sensitive < migration
                 < integration < delivery < publication
```

Only contract-neutral requests may use Fast. Every other floor promotes to
Complex. Normal and YOLO share the same risk classifier and safety floors.
YOLO additionally records one immutable authorization document bound to the
repository, feature, request digest, ceiling, target branch, agent permission,
and optional expiry. Publication cannot be inferred or granted by YOLO.

## Workflows

Fast is contract-neutral:

```text
implement → done (verified)
```

Complex is contract-bearing:

```text
specify → design → plan → implement → context (when repository knowledge is invalid) → verify → review → integrate
                                                            ├─→ done (integrated)
                                                            └─→ deliver → done (delivered)
```

Delivery exists only when Policy v2 and standing authorization cover it.
Publication is a separate explicit, immutable operation after delivery.
`implemented`, `verified`, `integrated`, `delivered`, and `published` are
derived states; callers cannot assert them directly.

Outcomes are `passed`, `failed`, `awaiting_human`, and `blocked`. Fast failure
promotes the same feature to Complex Specify. Verify or Review failure returns
to Implement within the configured repair limit.

## Impact and capabilities

Complex Specify freezes a digested impact manifest. Behavioral work must name
capabilities and provide valid ADDED, MODIFIED, or REMOVED delta documents.
Non-behavioral work must name no capability and provide a regression rationale.

Behavioral capabilities are claimed below the repository Git common directory,
so linked worktrees see the same ownership. A claim records each capability's
base digest. Integrate replays the reviewed delta against the current target,
detects conflicts, validates the candidate in an independent worktree, commits
the canonical projection transactionally, and writes an immutable receipt.
Direct Schema-4 Archive is retired.

## Evidence receipts

`empirical_evidence_execute` runs one exact Policy v2 argv without a shell.
`empirical_evidence_collect` fingerprints repository-contained artifacts.
Both produce immutable receipts containing criteria, evidence kinds, source
provenance, command or artifact results, timestamps, and a canonical digest.

Completion accepts receipt IDs only. It validates digests, criterion coverage,
required test/review/UI kinds, artifact containment, source binding, and phase
applicability. A copied boolean such as `passed: true` is never evidence.

After Implement, Empirical inspects Manifest v2. Source-neutral work advances
normally; source changes that leave knowledge stale, missing, invalid, or
placeholder-only route to the persisted `context` phase. Context completion
requires an explicit refresh, evidence-backed topic refinement, managed-marker
removal, and a second refresh whose report has empty `stale`, `missing`, and
`refinementRequired` lists.

## External tracker projection

Tracker Policy is an optional sidecar to Schema 5. Its absence preserves
existing repositories exactly and means `local-only`; it does not trigger a
workflow schema migration. Both strict versions choose one GitHub, Linear, or
Jira target, store the complete normalized `specification`, `planned`,
`in-progress`, `verification`, `review`, `blocked`, and `done` map, and
reference credentials by environment-variable name only. Credential names use
the strict uppercase runtime grammar; the host injects nonblank values with
access to the exact configured target. Policy stores neither values nor
provider authorization.

Policy v1 remains readable and byte-preserved. Its effective behavior is manual
ticket binding plus the legacy provider projection. Policy v2 adds `ticket` as
`off | manual | ensure` and `visibility` as `blockers-final | milestones |
revisions`. `off` performs no provider access. `ensure` binds one valid request
reference, one exact stable-marker match, or a newly created ticket only after
a complete zero-match reconciliation. Ambiguity is durable failure state, never
a selection heuristic.

Discovery is ephemeral and provider-neutral: strict input names a provider and
credential variables; output contains canonical/display identities, parent
relationships, state semantics/positions, capabilities, completeness, and a
digest. Mapping suggestions rank provider semantics and lifecycle position
before name refinements, allow shared provider states, and leave tied primary
ranks unresolved. Preview repeats discovery and validates the entire selected
hierarchy and map before atomic policy persistence.

The local journal commits first. A tracker sync then writes a checksummed
feature-local pending operation keyed by feature and revision, converges one
target-bound ticket, and advances the binding only after remote success. Policy
v2 pending records additionally acknowledge deterministic state-transition,
milestone-comment, and artifact effects separately. Effect keys bind provider
target, feature, revision, sorted receipt digest, kind, and artifact digest, so
partial retry skips confirmed effects. The
binding and pending operation retain digests of the exact provider target and
effective policy. Reconfiguring the target therefore fails locally instead of
combining an old remote identity with a new destination. Changing the status
map for the same target invalidates the synchronized fast path and reprojects
the committed revision through the new mapping.

Durable pending work is the reconciliation source after interruption. Normal
retry resumes that exact operation before deriving newer work. A persisted
`dispatched` flag separates a create that has never been sent from one that may
have reached the provider. Sync may send the initial create only while the
intent is durably undispatched. Once it is marked dispatched, retry performs a
bounded lookup for the exact persisted create marker and never sends that
attempt again automatically; without one unique match, explicit attachment is
required unless the caller confirms a new attempt while accepting duplicate
risk.

Policy v2 milestone comments append phase, revision, progress, completion,
summary, blocker, and reviewable artifacts without editing human descriptions.
Artifacts can originate only in committed immutable collected receipts and are
rechecked for digest, containment, symlinks, media type, secret-like path, count,
and size before upload or a commit-pinned durable link. Artifact bytes and
credential values are never persisted in tracker state.

The remote system is never read as workflow authority. Provider failures
therefore change only tracker health (`pending` or `failed`) and cannot alter
the phase, revision, criteria, or completion level. Status reports policy
behavior, remaining effects, committed/last-synchronized/pending revisions, and
bounded credential-safe failure context without contacting the provider.

## Persistence

```text
.empirical/config.json                         # Schema 5
.empirical/policy.json                         # Policy v2
.empirical/tracker.json                        # optional Tracker Policy v1 or v2
.empirical/context/manifest.json               # Manifest v2
.empirical/capabilities/<capability>/spec.md
.empirical/specs/<feature>/state.json
.empirical/specs/<feature>/impact.json
.empirical/specs/<feature>/evidence/<receipt>.json
.empirical/specs/<feature>/tracker/binding.json
.empirical/specs/<feature>/tracker/pending.json
.empirical/specs/<feature>/events/snapshot.json
.empirical/specs/<feature>/events/NNNNNNNN.json
```

Events contain sequence, previous-event digest, before/after state digests, and
the resulting state. Terminal completion transactionally promotes a verified
snapshot and retains one linked compaction-boundary event. State JSON remains a
recoverable projection of that authoritative chain.

## Isolation and handoff

An unrelated request returns a read-only worktree proposal bound to the base
commit, branch, path, active feature, and integrity token. Creation requires
literal approval and revalidation. Agent handoff likewise proposes exact cwd,
prompt, argv, capability class, and approval token; Empirical never launches
the process itself.
