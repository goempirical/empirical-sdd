# Architecture

Empirical 0.22 is a TypeScript library, Node.js CLI, stdio MCP server, and one
generated agent skill over one repository-native Schema 5 model.

## Boundaries

- `protocol.ts` defines strict shared schemas, canonical JSON, digests,
  authorizations, impacts, receipts, and completion derivation.
- `operations.ts` is the single frozen registry for MCP names, internal verbs,
  summaries, workflows, modes, and the single skill.
- `core.ts` owns workflow transitions, exact revisions, phase gates, routing,
  receipt use, and orchestration.
- `storage.ts` owns safe paths, atomic projections, locks, journal recovery, and
  Schema-5 invariants.
- `journal.ts` owns hash chains, snapshot verification, transactional
  compaction, and interrupted-compaction recovery.
- `migration.ts` performs the one supported atomic Schema 4 → 5 transform.
- `runtime.ts` executes exact argument arrays without a shell and captures
  bounded output.
- `evidence.ts` creates and verifies executed and collected receipts.
- `coordination.ts` owns Git-common-dir identity, capability claims, base replay,
  candidate validation, projection rollback, and integration receipts.
- `delivery.ts` owns protected GitHub source/evidence PR convergence and
  explicit publication planning.
- `tracking.ts` owns the optional provider-neutral ticket policy, feature-local
  bindings and retry projections, and GitHub, Linear, and Jira adapters.
- `knowledge.ts` owns Manifest v2 fingerprints and fresh-by-default retrieval.
- `doctor.ts` performs read-only cross-subsystem diagnostics.
- `cli.ts`, `mcp.ts`, and `integrations.ts` are registry-backed adapters, not
  alternate workflow implementations. Global uninstall reuses integration
  containment and ownership checks, then `lifecycle.ts` removes the npm package
  last through an exact shell-free argv.

Legacy discovery, decision, agent handoff, selector, setup, and worktree modules
remain focused owners of those boundaries.

## Ownership model

```text
Git common directory
└── capability claims shared by all linked checkouts

repository checkout
├── Schema-5 config + Policy v2 + Manifest v2
├── optional secret-free Tracker Policy v1
├── living capability projections
├── discovery records
└── selected feature
    ├── spec + design + decisions + plan + impact + deltas
    ├── optional tracker binding + durable pending projection
    ├── immutable evidence/integration/delivery receipts
    └── state projection + hash journal + terminal snapshot
```

Checkout selection lives in the checkout's absolute Git directory. Claims live
under the common directory. This separation prevents two linked worktrees from
selecting each other's workflow state while still serializing changes to the
same living capability.

## Transition integrity

A workflow transition acquires an ownership-aware feature lock, verifies the
exact revision and immutable artifacts, prepares any rollback-capable effect,
appends a linked event, writes the state projection atomically, and releases
only its own lock. Terminal paths compact the chain to a verified snapshot and
boundary. Stale-lock recovery checks age, process liveness, inode/device
identity, and ownership token.

Migration stages, markers, and backups use reserved top-level names. Before a
marker exists, candidate transform/validation failure removes the exact owned
stage. After a marker exists, recovery alone controls stage/backup promotion.
Knowledge, evidence hashing, and source overlays exclude these transaction
trees; Doctor reports unmarked survivors without deleting them.

Integration adds a second transaction boundary. It verifies Git repository
identity, replays deltas from captured bases, temporarily projects candidates
into a different worktree, runs every exact Policy command there, restores the
target, then promotes source capability projections with rollback and records a
receipt. The feature is not `integrated` until that receipt and state transition
both succeed.

External tracking is a separate one-way projection boundary. Every workflow
transition commits its local journal and state projection first. A later
tracker sync snapshots that committed revision into a checksummed pending
record, converges the bound remote ticket with a stable idempotency marker, and
only then advances the binding's last-synced revision. Provider failure cannot
roll back, demote, or block the local state machine.

## Delivery and publication

Delivery requires Policy v2, repository-bound authorization, a verified
integration, an exact target branch, and declared checks. It converges a source
PR, waits for required green checks, merges it without admin or force, creates
a source-merge binding, then converges and merges an evidence PR. Both merge
commits and command receipts are digested in the delivery receipt.

Publication is intentionally outside the workflow's inferred path. A caller
must explicitly provide an exact package, semantic version, dist-tag, merged
commit, literal approval, and an authorization bound to that exact request.
Empirical independently inspects and then re-inspects remote Git, GitHub, and
npm state. Conflicting tags, releases, versions, or dist-tags stop instead of
being replaced.

## Knowledge and diagnostics

Manifest v2 records normalized source fingerprints and generated-page source
sets. Retrieval returns only fresh, semantically refined pages. Managed or exact
legacy placeholder topics in a nonempty repository are reported through
`refinementRequired` and withheld from usable context. After source-changing
Implement work, the state machine conditionally inserts Context: the host agent
refreshes inventory, refines topics from inspected evidence, removes managed
markers, and refreshes again before Verify or Done. Doctor reports stale,
missing, invalid, and refinement-required knowledge without mutation.

## Package surface

The supported exports are the main library, `./protocol`, `./mcp`, and
`./integrations`. The build emits Node-compatible ESM and declarations. CI
tests supported Node lines 22, 24, and 26 and enforces distribution, consumer,
registry-consistency, aggregate coverage, and per-module coverage gates.

The public lifecycle CLI exposes Install, Update, and Uninstall. Uninstall owns
only catalog-derived global skill paths, valid owner-stamped selection metadata,
and the global package. Repository discovery and project `.empirical` or MCP
mutation are outside that command's authority.
