# Plan: Release 0.25.0

1. Add the Windows tracker secret-path correction to the existing `0.25.0`
   `Fixed` changelog section and confirm every version surface remains aligned.
2. Run focused changelog/consistency checks, the full `bun run ci` release
   suite, and a filename-only credential-pattern scan; collect the immutable
   execution receipt against the exact tree.
3. Refresh repository context, review the source/evidence diff against AC-1
   through AC-6, and resolve every review finding before approval.
4. Integrate the package-distribution delta against an independent clean
   `origin/main` worktree and retain its receipt.
5. Deliver `CHANGELOG.md` on `release/0.25.0-prep` and the Empirical context,
   capability projection, and `release-0-25-0` evidence on
   `evidence/release-0-25-0`; wait for all protected CI jobs and merge serially.
6. Confirm the final evidence merge includes PR #34, re-check that `v0.25.0`
   and npm `0.25.0` are absent, create exact publication authorization, and
   publish the annotated tag/GitHub release.
7. Wait for the OIDC trusted-publishing workflow, then retry the exact
   idempotent publication request so the GitHub release, npm version, `latest`,
   and Empirical publication receipt converge.
