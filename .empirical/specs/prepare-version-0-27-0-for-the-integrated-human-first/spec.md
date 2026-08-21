# Prepare Version 0 27 0 For The Integrated Human First

## Request

> Prepare version 0.27.0 for the integrated human-first tracker comments change, create and merge a non-draft pull request into goempirical/empirical-sdd main, then publish the immutable v0.27.0 GitHub release and npm latest package.

## Goal

Publish one immutable `empirical-sdd@0.27.0` release from the final protected
`main` evidence merge. The release contains the integrated human-first tracker
milestone comments for GitHub, Linear, and Jira, retains Schema 5 and Tracker
Policy v1/v2 compatibility, and exposes the same version through Git, GitHub,
npm, and the `latest` dist-tag.

## Acceptance Criteria

- [ ] [AC-1] `PRODUCT_VERSION`, `package.json`, public CLI/help output,
  version-sensitive tests, clean-consumer assertions, versioning policy, and
  the dated changelog heading all identify `0.27.0`, while `SCHEMA_VERSION`
  remains `5` and no repository migration is required.
- [ ] [AC-2] `CHANGELOG.md` moves the human-first Tracker Policy v2 comment
  entry from Unreleased into `0.27.0` dated `2026-08-21`, describes the
  GitHub/Linear/Jira behavior and compatibility truthfully, and adds correct
  `v0.26.1...v0.27.0` compare links.
- [ ] [AC-3] The complete local `bun run ci` gate passes: TypeScript checking,
  the serialized test suite and coverage floor, built MCP smoke tests, clean
  packed-consumer verification, consistency checks, and `git diff --check`.
- [ ] [AC-4] `npm pack --dry-run --json` identifies exactly
  `empirical-sdd@0.27.0`; the candidate contains only the intended public
  package surface, includes `CHANGELOG.md` and `docs/versioning.md`, and passes
  installation/import checks in a clean consumer.
- [ ] [AC-5] The final delivered source and evidence commits pass the configured
  GitHub Actions matrix on Ubuntu Node 22/24/26, macOS Node 24, and Windows
  Node 24 without bypassing branch protection.
- [ ] [AC-6] Empirical performs its protected source-then-evidence pull-request
  sequence against `goempirical/empirical-sdd:main`, normally merges both, and
  binds the release candidate to the resulting evidence merge commit.
- [ ] [AC-7] After exact commit-bound publication authorization, annotated tag
  `v0.27.0`, the non-prerelease GitHub release, npm version
  `empirical-sdd@0.27.0`, and npm `latest` all converge on the authorized
  commit/version; a repeated inspection creates or changes nothing.
- [ ] [AC-8] Existing immutable tags, releases, package versions, and dist-tags
  are never deleted, force-updated, replaced, or reassigned on conflict, and no
  credential value enters chat, Git, command arguments, evidence, or package
  contents.
- [ ] [AC-9] The release branch incorporates current upstream `main` before
  delivery, contains the integrated human-first tracker implementation and its
  accepted capability projection, and excludes unrelated worktree changes.

## Scope

- Prepare the integrated human-first tracker-comment change as alpha MINOR
  `0.27.0` while retaining Schema 5 and Tracker Policy v1/v2 compatibility.
- Align every public, test-facing, and packaged version surface.
- Finalize the dated changelog and release-specific versioning note.
- Reconcile current upstream `main`, run the complete local/package gates, and
  inspect the packed artifact.
- Deliver through the repository's protected source and evidence pull requests.
- Publish exactly `empirical-sdd@0.27.0`, `v0.27.0`, and `latest` from the final
  evidence merge through the trusted GitHub release workflow.

## Non-goals

- No additional tracker behavior, provider integration, template
  customization, dependency upgrade, Schema 6 migration, prerelease, or
  version beyond `0.27.0`.
- No force push, tag rewrite, artifact replacement, admin merge, protection
  bypass, local npm-token handling, external ticket mutation, or managed-host
  rollout.

## Risks

- Version drift could ship mismatched runtime, package, documentation, tests,
  or changelog values; consistency and clean-consumer gates must reject it.
- The feature branch predates the latest upstream release-evidence merge;
  reconciliation must preserve both upstream changes and this feature without
  silently dropping either.
- Platform-only failures could invalidate the release; every configured GitHub
  matrix job must pass on the protected delivery commits.
- Partial or conflicting publication could split public identities; immutable
  preflight/postflight checks must stop on conflicts and converge only the exact
  authorized version.
- Publication credentials must remain owned by GitHub trusted publishing and
  must never be copied into repository or workflow artifacts.

## Verification

- `bun run ci`
- `npm pack --dry-run --json`
- GitHub Actions checks for Ubuntu Node 22/24/26, macOS Node 24, and Windows
  Node 24 on the delivered source and evidence commits
- `git merge-base --is-ancestor <release-commit> upstream/main`
- `gh release view v0.27.0 --repo goempirical/empirical-sdd`
- `npm view empirical-sdd@0.27.0 version --json`
- `npm view empirical-sdd dist-tags --json`
- Empirical verification, integration, delivery, and publication receipts

## Capability Deltas

- `package-distribution`: bind release `0.27.0` to the integrated human-first
  tracker comments, supported-platform matrix, protected evidence merge, and
  immutable public artifacts.
