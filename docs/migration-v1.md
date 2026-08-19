# Migration to Empirical 0.22

## Schema 4 → Schema 5

Empirical 0.22 supports one breaking, atomic migration from Schema 4. Invoke an
installed Empirical skill after upgrading. The migrator performs a read-only
preflight, rejects symbolic links and mixed/conflicting layouts, builds a
complete candidate tree, validates every transformed document and journal, and
only then promotes the candidate.

The transform creates strict Schema-5 feature state, Policy v2, Manifest v2,
impact manifests, completion state, hash-chained journals, and a compact
migration receipt. Legacy `archive` state becomes `integrate`; it is not marked
integrated without a new independent integration receipt. The previous layout
is retained in the transaction backup until promotion and recovery complete.
An interruption is either rolled forward from its verified transaction marker
or restored without leaving mixed versions.

Exact legacy TODO context templates remain marker-managed and are reported as
refinement-required in nonempty repositories; custom legacy context is kept
unmanaged and byte-preserved. The host agent must refine managed topics from
repository evidence before a post-implementation Context gate can pass.

Top-level `.empirical.schema5-*` stages/markers and
`.empirical.schema4-backup-*` directories are reserved migration transaction
state, not product source. A candidate failure before marker creation removes
only the exact stage created by that attempt. Doctor reports any unmarked orphan
read-only; inspect it before moving or removing it manually.

Schema 5 does not maintain a permissive compatibility reader. A project that
contains Schema-5 configuration plus legacy root state, legacy events, or
Schema-4 feature projections fails closed with a migration conflict.

## Earlier npm alpha schemas

Schemas 1–3 are not directly accepted by 0.22. First use the Empirical version
that created the repository to migrate it to Schema 4, verify that state, and
then upgrade to 0.22. Alternate historical parallel-state directories remain
unsupported because their histories cannot be assigned safely.

## Empirical v1 (`ai/`)

Use the existing non-destructive adoption operation before the Schema-5
migration. Adoption reads `ai/STATE.md`, copies an available current spec, and
leaves `ai/` untouched. Verify the resulting Schema-4 repository, then upgrade
to 0.22 and run the atomic migration.

## Tracker Policy v1 → v2

Tracker policy versioning is independent from the repository Schema 4 → 5
migration. A valid `.empirical/tracker.json` with `schemaVersion: 1` remains
accepted and is not rewritten by Init, repair, Doctor, status, or ordinary
loading. It continues to use explicit manual create/attach and the legacy
provider state projection, including the historical managed Linear description
block.

To upgrade deliberately, invoke `empirical-init`, choose Change tracker, run
provider discovery, review/edit all seven semantic mappings, select ticket
behavior and progress visibility, and approve the effective preview. For
automation, call `tracker-discover`, `tracker-suggest` for the selected workflow
parent, construct the strict v2 policy, `tracker-preview`, then
`tracker-configure`; `init --tracker-input` and the MCP
`tracker` preserve/disabled/apply union expose the same setup contract. The v2
target shape and credential environment-variable names are unchanged, while
the policy adds:

```json
{
  "ticket": "off | manual | ensure",
  "visibility": "blockers-final | milestones | revisions"
}
```

Upgrading does not replace an existing feature binding. Same-target bindings
are reprojected under the new policy digest; target drift still requires an
explicit replacement. New v2 Linear progress is append-only through comments
and leaves descriptions untouched. Dormant v1 binding/pending records remain
locally diagnosable. To stop tracking, choose No tracking; this atomically
replaces only the active policy with the provider-free disabled setup record
and performs no provider request, so dormant feature records can be recovered
if a policy is restored.

After an interrupted ensure create, retry sync first: dispatched attempts are
reconciled and never blindly resent. `TRACKER_BIND_AMBIGUOUS` requires choosing
one target-valid ticket. Provider/comment/upload outages preserve acknowledged
effects; restore credentials/permissions or availability and retry. Artifact
errors require a new committed safe evidence receipt rather than editing an
immutable receipt.

## Operational checks

Run Doctor before and after migration. Doctor is read-only: it reports whether
migration is required and validates the final schema, journal chain, policy,
knowledge, receipts, claims, locks, worktrees, tools, and delivery artifacts.
Migration scratch is excluded from knowledge fingerprints, evidence tree
digests, and integration source overlays. Do not manually combine old and new
state trees.
