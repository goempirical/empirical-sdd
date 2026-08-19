# Deliver 0.24 Release Readiness Design

## Context

`harden-0-24-release-readiness` is independently verified and integrated in
the local authoritative checkout, but its normal-mode authorization ended at
integrated. The protected remote `main` branch still points at the already
delivered SDD-23 evidence commit. Publication must remain a later exact action.

## Delivery shape

Use the existing Empirical two-pull-request delivery protocol under a new,
durable authorization whose maximum completion level is `delivered` and whose
target is `main`.

1. Commit only product/source surfaces to a stable source branch: release
   notes, two managed skill copies, three runtime modules, and two regression
   test files.
2. Push and open the source PR with its repository/feature/commit marker.
3. Observe configured checks, merge normally, and obtain the remote merge
   commit.
4. Materialize `delivery-source.json` with that exact source merge identity.
5. From remote `main`, commit all authoritative Empirical state in a distinct
   evidence branch: living capability projections, context, the prior SDD-23
   delivery compaction, both readiness feature histories and receipts, and the
   delivery-only feature state.
6. Push, open, observe, and merge the evidence PR, then persist and compact the
   delivery receipt locally.

Stable branch names and embedded idempotency markers make an interrupted run
observable and resumable. No force push, direct main commit, mutable tag, or
credential-copying fallback is part of the design.

## Exact publication preflight

After delivery, independently resolve remote `main`, GitHub PR/check state,
the `v0.24.0` tag, GitHub Release, npm version, and `latest` dist-tag. Build the
authorization request from the final merged commit only. This step is
read-only: the `delivered` authorization cannot be used by publication code,
and publication still requires literal approval plus a separate `published`
authorization bound to the exact feature, commit, version, and dist-tag.

## Verification

- The prior immutable CI and review receipts remain bound to the source tree.
- The delivery receipt records source/evidence PR numbers, head and merge
  commits, target branch, command digests, and authorization digest.
- GitHub is queried after each remote mutation; retries discover the marker
  before creating anything.
- Final-main workflow checks and package/version consistency are inspected
  before the exact publication target is presented.

## Failure handling

- A push, PR, check, or merge failure leaves the local journal and stable remote
  marker available for retry.
- A branch/marker/head mismatch stops as ambiguity instead of overwriting it.
- A release artifact already bound to another commit or version stops preflight.
- Missing host authentication fails truthfully; no credential value is read,
  printed, or persisted by Empirical.
