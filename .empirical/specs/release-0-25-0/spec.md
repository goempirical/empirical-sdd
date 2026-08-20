# Release 0 25 0

## Request

> Finalize and publish empirical-sdd 0.25.0 from the Windows-corrected main branch. Add a concise 0.25.0 changelog note for the cross-platform tracker secret-path correction, verify the complete release suite and five-platform GitHub matrix, deliver the release-note source and immutable workflow evidence through protected pull requests, then publish exactly empirical-sdd@0.25.0 with npm dist-tag latest and GitHub tag/release v0.25.0 from the final evidence merge commit.

## Goal

Publish one immutable `empirical-sdd@0.25.0` release from the final protected
`main` merge that contains the OAuth-first tracker authentication feature and
its Windows path correction, with aligned changelog, GitHub, npm, and Empirical
evidence.

## Acceptance Criteria

- [ ] [AC-1] `CHANGELOG.md` records the Windows tracker-secret path correction
  under `0.25.0` without changing the already-aligned package or protocol
  version.
- [ ] [AC-2] The complete release suite passes with 253 tests, the configured
  coverage floor, bundled MCP smoke, clean packed-consumer verification,
  consistency checks, TypeScript checks, and a clean diff check.
- [ ] [AC-3] GitHub Actions passes on Node 22, 24, and 26 on Ubuntu plus Node 24
  on macOS and Windows for the final release source.
- [ ] [AC-4] The release note and immutable workflow evidence are delivered
  through distinct protected pull requests, and the publication commit is the
  resulting evidence merge commit containing the Windows fix.
- [ ] [AC-5] The annotated tag `v0.25.0`, GitHub release, npm version
  `empirical-sdd@0.25.0`, and npm `latest` dist-tag all resolve to the exact
  authorized release and converge on idempotent inspection.
- [ ] [AC-6] No tag, GitHub release, npm publication, or dist-tag mutation occurs
  before exact publication authorization; no credential value enters a commit,
  command argument, log, receipt, or release artifact.

## Scope

- Add one concise `0.25.0` changelog entry for the merged Windows correction.
- Verify the release locally and through the supported GitHub Actions matrix.
- Deliver separate source and evidence pull requests against `main`.
- Publish exactly version `0.25.0` with dist-tag `latest` from the final
  evidence merge commit through the repository's trusted npm workflow.

## Non-goals

- No additional tracker-authentication behavior or public API change.
- No version beyond `0.25.0`, prerelease, replacement, force push, tag rewrite,
  or protected-branch bypass.
- No local npm credential handling and no deployment to external hosts.

## Verification

- `bun run ci`
- GitHub Actions matrix for the final source PR and final `main` merge
- `gh release view v0.25.0 --json tagName,targetCommitish,url`
- `git ls-remote --tags origin refs/tags/v0.25.0 refs/tags/v0.25.0^{}`
- `npm view empirical-sdd@0.25.0 version --json`
- `npm view empirical-sdd dist-tags --json`
- Empirical integration, delivery, and publication receipts

## Capability Deltas

- `package-distribution`: bind the `0.25.0` release to the corrected final
  evidence merge and require the complete five-platform matrix before
  publication.
