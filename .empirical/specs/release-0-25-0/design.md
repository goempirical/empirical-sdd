# Design: Release 0.25.0

## Baseline

The release worktree starts from `main` after merge commit `97a2aadb`, which
contains the OAuth-first tracker authentication source, evidence, and the
Windows-specific path correction verified by PR #34. Version surfaces already
report `0.25.0`; the only source edit is a concise changelog entry documenting
that correction.

## Implementation

1. Add one `Fixed` entry under the existing `0.25.0` changelog heading. Do not
   change package, protocol, schema, API, or runtime behavior.
2. Run the complete serial release suite and record an immutable executed
   receipt. Verify the Windows correction through the GitHub Actions matrix,
   which covers Ubuntu Node 22/24/26 and Node 24 on macOS/Windows.
3. Review the exact diff, evidence, capability delta, and absence of release
   artifacts or credential material before integration.
4. Replay the package-distribution delta against an independent `main`
   worktree, then deliver the changelog source and workflow evidence through
   distinct protected pull requests.
5. Bind exact publication authorization to the final evidence merge commit,
   package `empirical-sdd`, version `0.25.0`, and dist-tag `latest`.
6. Create the immutable annotated tag and GitHub release. The release event
   triggers the repository's npm trusted-publishing workflow with OIDC. Inspect
   GitHub, npm, and the dist-tag until all surfaces converge, then persist the
   publication receipt.

## Safety Boundaries

- Never publish from the earlier evidence commit because it predates the
  Windows correction.
- Never rewrite a tag, release, npm version, or protected branch; any conflict
  stops publication.
- Never read, copy, print, or pass npm/GitHub/tracker credential values. GitHub
  CLI uses its host configuration and npm publication uses trusted publishing.
- Generated coverage, build output, tarballs, and unrelated worktree state are
  excluded from commits.

## Failure and Retry

Every public release surface is inspected before and after mutation. If the
GitHub release exists while trusted npm publication is still running, the same
exact authorized request is retried only after the workflow completes; the
publication planner then observes existing matching artifacts and converges
without replacement.

## Verification

- Changelog diff contains only the intended `0.25.0` correction.
- `bun run ci` passes 253 tests and all package/coverage/consistency checks.
- The five GitHub Actions jobs pass for final source and `main`.
- Source/evidence PR receipts identify merged protected PRs.
- Remote tag, GitHub release, npm version, and `latest` all match the exact
  authorized final evidence merge commit and version.
