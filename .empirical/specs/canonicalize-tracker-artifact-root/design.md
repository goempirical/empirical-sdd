# Canonicalize Tracker Artifact Root Design

## Evidence

The macOS GitHub Actions failure occurs before Jira transport dispatch with
`TRACKER_ARTIFACT_UNSAFE: An evidence artifact escapes the repository`. The
temporary repository is opened through `/var/...`, while `realpath(root)` is
`/private/var/...`. The current implementation compares an artifact resolved
from the lexical root with the canonical root, so two names for the same tree
appear unrelated.

## Design

Canonicalize the repository root at projection eligibility and again at the
final pre-upload reread, then resolve every receipt-relative artifact path from
that canonical root. Retain the two existing containment checks at each
boundary:

1. Reject lexical traversal outside the canonical root before filesystem
   inspection.
2. Reject symlinks and non-regular files, then compare the artifact's real path
   with the same canonical root before reading or projecting it.

All media-type, secret-name, byte-size, aggregate-size, digest, durable-link,
and receipt validation remains unchanged.

## Regression fixture

Create a real temporary repository, add an approved artifact, and expose the
repository through a sibling symbolic-link alias. Open `EmpiricalProject` from
the alias and exercise the same Jira attachment path used by the existing
lost-response recovery test. The test must demonstrate that projection reaches
the provider transport and that a retry acknowledges the existing attachment
without a duplicate upload. Existing unsafe-artifact coverage continues to
prove the fail-closed boundary.

## Delivery

Commit only the source and regression-test change on the isolated branch. Push
that commit as a fast-forward of the existing PR #24 source branch, replace the
PR's exact Empirical commit marker, and wait for the complete Actions matrix.
Do not force-push, publish, or deploy as part of this fix.

## Verification

- Focused: `bun test tests/tracking.test.ts --timeout 60000`.
- Complete: `bun run ci`.
- Remote: all required GitHub Actions checks at the updated PR head.
- Review: confirm both artifact-resolution boundaries use `canonicalRoot`, and
  the regression would fail at each previous lexical-root implementation.

## Risks and mitigations

- Resolving from the canonical root could weaken containment if later checks
  use a different base. Both lexical and real-path checks therefore share the
  same `canonicalRoot`.
- A symlink fixture may be unsupported on some Windows environments. The test
  uses a directory junction on Windows and a directory symbolic link elsewhere,
  while asserting the roots genuinely differ before exercising projection.
- Delivery may race a moved PR branch. The push must be a normal fast-forward;
  any non-fast-forward rejection stops for reconciliation.
