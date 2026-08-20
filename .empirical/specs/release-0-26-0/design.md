# Design: Release 0.26.0

## Release candidate

Treat the completed concise ticket-policy capability as an alpha MINOR because
it adds public configuration, MCP/CLI surfaces, generated harness behavior, and
ticket-requirement semantics. Advance only `PRODUCT_VERSION` and aligned
package/test/documentation values to `0.26.0`; retain Schema 5 and Tracker Policy
v1/v2 compatibility.

Move the current Unreleased entries into a dated `0.26.0` changelog section,
state that existing repositories require no state migration, and update compare
links. The versioning note describes this candidate instead of `0.25.0`.

## Verification

Use the repository's configured `ci` evidence command as the complete local
gate. It type-checks, runs the entire suite under coverage, builds and smokes the
MCP distribution, packs and installs into a clean consumer, checks cross-file
consistency, and checks the diff. Inspect `npm pack --dry-run --json` separately
to retain an explicit release-surface artifact.

The protected source PR must pass the five configured GitHub jobs: Ubuntu on
Node 22, 24, and 26, plus macOS and Windows on Node 24. The evidence PR is based
on the source merge and must pass the same required checks before its normal
merge.

## Delivery

Empirical owns delivery under its repository-bound authorization. One source
commit contains the release candidate and pre-delivery workflow artifacts. A
separate evidence commit contains immutable verification/integration receipts
and is bound to the source merge. Both are delivered through ordinary PRs to
`main`; no force, admin, or branch-protection bypass is permitted.

The final evidence merge SHA becomes the only eligible publication commit.

## Publication

Publication remains a separate operation after delivery. Before acting, inspect
the remote tag, GitHub release, npm version, and `latest` dist-tag. Obtain a
literal authorization whose digest binds the repository, feature,
`empirical-sdd`, `0.26.0`, `latest`, and the exact evidence merge SHA. Then use
the immutable publication operation and re-inspect every public surface.

The GitHub release triggers trusted npm publishing. If the local convergence
operation returns while that hosted workflow is still running, preserve all
created immutable artifacts, wait for the same tag's workflow, and retry only
the identical authorized request. Conflicts stop; no artifact is moved or
replaced.

## Failure handling

- A local or hosted test failure returns the workflow for a bounded repair and
  requires fresh evidence.
- A changed `main` is handled by independent integration replay before delivery.
- An immutable remote conflict blocks publication without deletion or force.
- A partial publication resumes only by inspecting and converging the identical
  version/commit request.
- Credentials remain in GitHub/npm trusted stores and are never copied into
  policy, commands, receipts, or chat.
