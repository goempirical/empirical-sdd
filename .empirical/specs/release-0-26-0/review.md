# Review: Release 0.26.0

## Outcome

Pass for the implemented release candidate. No blocking correctness, security,
compatibility, packaging, or documentation finding remains. Live GitHub matrix,
two-PR delivery, and public artifact convergence are deliberately still pending
their protected external gates and are not claimed by this local review.

## Scope reviewed

- Complete `origin/main` delta, including the previously reviewed and
  independently integrated concise ticket-policy feature.
- Release-only version, changelog, documentation, test, package, and context
  changes after commit `a5e87c0`.
- Accepted decisions D-001 through D-003, Policy v2 delivery, GitHub CI, and the
  trusted npm publish workflow.
- Passing and failed immutable evidence receipts plus the `npm pack --dry-run`
  distribution listing.

## Criterion review

- AC-1 — Pass locally. Runtime/package/test/docs identify `0.26.0`; consistency
  reports Empirical `0.26.0`, Schema `5`, one skill, and 37 operations.
- AC-2 — Pass locally. Unreleased changes are under `0.26.0` dated 2026-08-20,
  compare links are aligned, and compatible repositories have explicit
  no-migration guidance.
- AC-3 — Pass. Receipt `executed-5c2ad36acc8549cfe42e316e` records 259/259
  tests, zero failures, 90.12% line coverage, 91.31% function coverage, built
  MCP smoke, clean packed consumer, consistency, and clean diff.
- AC-4 — Pass locally. The dry run lists 53 entries for
  `empirical-sdd@0.26.0`, including the changelog, versioning policy, supported
  runtime/typing surface, and offline demo; the clean consumer rejects internal
  package subpaths.
- AC-5 — Correctly gated. The checked-in matrix names Ubuntu Node 22/24/26 and
  macOS/Windows Node 24. Actual green runs must be observed during delivery.
- AC-6 — Correctly gated. Policy targets `main`; tested delivery logic requires
  normal source and source-bound evidence PR merges. The live receipt will
  supply the final publication SHA.
- AC-7 — Correctly gated. Publication validates literal approval and exact
  repository, feature, package, version, dist-tag, and evidence-merge SHA before
  immutable preflight/convergence. No publication authorization exists yet.
- AC-8 — Pass locally. No force/admin/replacement path is present. A redacted
  credential-shape scan found only deliberate security fixtures in test files,
  which are absent from the pack; no credential value is present in candidate
  or Empirical release artifacts.

## Evidence handling

The initial whole-suite receipt `executed-b6493f1cfcfb557d43ebf493` is retained
as failed because two process-heavy core tests reached their 120-second cold-run
timeouts. Both passed together under coverage in 2.31 seconds, and the fresh
complete run then passed all 259 tests in 167.21 seconds. The passing receipt,
not the failed receipt, is used to advance verification.

## Decision consistency

D-001 matches the documented alpha MINOR policy and Schema 5 compatibility.
D-002 matches delivery validation and the protected evidence-merge boundary.
D-003 matches the token-free trusted publishing workflow and immutable retry
model. No superseding decision is required.

## Findings

No blocking findings. External acceptance remains fail-closed until GitHub
checks, protected merges, exact commit-bound approval, and public postflight
inspection complete.
