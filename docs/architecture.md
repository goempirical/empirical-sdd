# Architecture

Empirical 0.27 is a TypeScript library, Node.js CLI, stdio MCP server, one
explicit global Init skill, and a repository-local automatic workflow over one
Schema 5 model.

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
- `tracking.ts` owns the unconfigured/disabled/configured setup state, provider
  discovery/preview and semantic mapping, optional Tracker Policy v1/v2,
  strict change-type/profile ticket rules, ensure/manual/off binding, target-bound feature
  bindings, per-effect durable pending operations, safe receipt artifacts, and
  GitHub, Linear, and Jira adapters.
- `knowledge.ts` owns Manifest v2 fingerprints and fresh-by-default retrieval.
- `doctor.ts` performs read-only cross-subsystem diagnostics, including whether
  all required repository activation integrations are present and current.
- `cli.ts`, `mcp.ts`, and `integrations.ts` are registry-backed adapters, not
  alternate workflow implementations. Integrations install a setup-only global
  `empirical-init`, marker-owned repository dispatchers and local workflow
  skills, and project MCP bridges. Global uninstall reuses integration
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
├── marker-owned automatic workflow dispatchers and local skills
├── optional disabled setup record or secret-free Tracker Policy v1/v2
├── living capability projections
├── discovery records
└── selected feature
    ├── spec + design + decisions + plan + impact + deltas
    ├── optional tracker binding + durable transition/comment/artifact ledger
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
tracker sync resumes durable pending work or snapshots that committed revision
into a checksummed pending record. A pure resolver combines the existing
request change classifier with the persisted workflow profile. Required work
validates a request reference, performs complete stable-marker reconciliation,
and creates only on one proven zero-match path; optional unreferenced work and
off work branch before authentication. It then converges provider state, append-only
milestone comments, and receipt-approved evidence through individually
acknowledged deterministic effects before advancing the binding. Policy v2
Linear updates never include description content. Binding target drift,
incomplete pagination, marker ambiguity, or unsafe evidence fails closed;
provider failure cannot roll back, demote, or block the local state machine.

Authentication remains outside that durable projection. A trusted host OAuth
resolver provides an ephemeral typed credential and, when needed, a validated
secret-free URL handoff. MCP uses the handoff only for explicitly negotiated
URL-mode elicitation. Resolution then falls back atomically to injected host
environment values and a guarded per-user secrets file; none of those values
enter policy, workflow state, tool results, or chat. Jira's typed request
context keeps OAuth Bearer/cloud API traffic distinct from tenant-origin Basic
fallback traffic across every adapter path.

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
missing, invalid, and refinement-required knowledge without mutation. For a
completed Schema 5 setup it also reports missing, drifted, or unsafe project
integrations; explicit Init performs the ownership-aware repair and Doctor then
verifies readiness.

## Package surface

The supported exports are the main library, `./protocol`, `./mcp`, and
`./integrations`. The build emits Node-compatible ESM and declarations. CI
tests supported Node lines 22, 24, and 26 and enforces distribution, consumer,
registry-consistency, aggregate coverage, and per-module coverage gates.

The public lifecycle CLI exposes Install, Update, and Uninstall. Uninstall owns
only catalog-derived global skill paths, valid owner-stamped selection metadata,
and the global package. Repository discovery and project `.empirical` or MCP
mutation are outside that command's authority.

The installed global skill is `empirical-init`, which is explicit-only where a
host supports invocation policy metadata and narrowly setup-scoped everywhere
else. Initialization writes the detailed `empirical` workflow into project
skill directories and short dispatchers into supported repository instruction
files. Those dispatchers activate only for change requests when Schema 5 config
is valid and setup is complete; read-only requests and uninitialized
repositories stay outside the state machine.
