# Release 0 26 0

## Request

> Prepare, fully test, deliver, and publish exactly empirical-sdd@0.26.0 with npm dist-tag latest and GitHub tag/release v0.26.0 from the final protected main evidence-merge commit. Include the completed concise ticket policy feature, classify it as an alpha MINOR without changing Schema 5, align PRODUCT_VERSION, package metadata, version-sensitive tests, demo/versioning documentation, and CHANGELOG; inspect the packed artifact; run the complete local CI suite and the five-platform GitHub Actions matrix; deliver source and immutable evidence through separate protected pull requests; then perform only the explicitly authorized immutable publication after exact remote checks.

## Goal

Publish one immutable `empirical-sdd@0.26.0` release from the final protected
`main` evidence merge. The release contains the completed concise-question and
ticket-requirement policy behavior, keeps Schema 5 compatible, and exposes the
same exact release through Git, GitHub, npm, and the `latest` dist-tag.

## Acceptance Criteria

- [ ] [AC-1] `PRODUCT_VERSION`, `package.json`, CLI/help output,
  version-sensitive tests, clean-consumer assertions, the demo heading,
  versioning policy, and the dated changelog heading all identify `0.26.0`,
  while `SCHEMA_VERSION` remains `5`.
- [ ] [AC-2] `CHANGELOG.md` moves the concise-question, ticket-rule matrix,
  optional no-ticket behavior, and provider-independent demo entries from
  Unreleased into `0.26.0` dated `2026-08-20`, with correct compare links and a
  clear statement that existing repositories require no state migration.
- [ ] [AC-3] The complete local `bun run ci` gate passes: TypeScript checking,
  the entire serialized test suite with its configured coverage floor, built
  MCP smoke tests, clean packed-consumer verification, consistency checks, and
  `git diff --check`.
- [ ] [AC-4] The packed `empirical-sdd@0.26.0` candidate contains only the
  intended distribution surface, includes `CHANGELOG.md` and
  `docs/versioning.md`, and installs and imports successfully in a clean
  consumer.
- [ ] [AC-5] GitHub Actions is green for Node 22, 24, and 26 on Ubuntu and Node
  24 on macOS and Windows for the final release source and evidence merge.
- [ ] [AC-6] Empirical delivers one protected source PR and one separate,
  source-bound evidence PR to `main`; the publication commit is the resulting
  evidence merge commit.
- [ ] [AC-7] After exact commit-bound literal approval, the annotated tag
  `v0.26.0`, GitHub release, npm version `empirical-sdd@0.26.0`, and npm
  `latest` dist-tag all resolve to the authorized evidence merge commit/version
  and converge on a repeat inspection.
- [ ] [AC-8] No release artifact is replaced, force-updated, or published from
  an unverified commit, and no credential value enters chat, Git, command
  arguments, logs, evidence, or the packed package.

## Scope

- Prepare the completed concise ticket-policy work as alpha MINOR `0.26.0`.
- Align every public and test-facing version surface without changing Schema 5.
- Finalize the changelog and release-specific versioning note.
- Run the complete local and supported-host release gates and inspect the pack.
- Deliver separate source and evidence pull requests through protected GitHub
  flow.
- Publish exactly `empirical-sdd@0.26.0`, `v0.26.0`, and `latest` from the final
  evidence merge after exact authorization.

## Non-goals

- No additional ticket-provider behavior, unrelated refactor, dependency
  upgrade, Schema 6 migration, prerelease, or version beyond `0.26.0`.
- No force push, tag rewrite, artifact replacement, admin merge, branch
  protection bypass, local npm-token handling, or remote ticket mutation.
- No managed-host rollout or automatic upgrade of existing installations.

## Risks

- Version drift could ship mismatched runtime, package, docs, or test values;
  the consistency and clean-consumer gates must reject it.
- Platform-only failures could invalidate the release; all five configured
  GitHub matrix jobs must pass on the delivered commit.
- A partial or conflicting publication could split public identities; immutable
  preflight and postflight checks must stop on conflicts and converge only the
  exact authorized version.
- Publication credentials and provider credentials must remain owned by their
  trusted hosts and never be copied into repository or workflow artifacts.

## Verification

- `bun run ci`
- `npm pack --dry-run --json`
- GitHub Actions checks for Ubuntu Node 22/24/26, macOS Node 24, and Windows
  Node 24 on the delivered source/evidence merge
- `git ls-remote --tags origin refs/tags/v0.26.0 refs/tags/v0.26.0^{}`
- `gh release view v0.26.0 --json tagName,targetCommitish`
- `npm view empirical-sdd@0.26.0 version --json`
- `npm view empirical-sdd dist-tags --json`
- Empirical verification, integration, delivery, and publication receipts

## Capability Deltas

- `package-distribution`: bind release `0.26.0` to the concise ticket-policy
  capability, supported-host matrix, protected evidence merge, and immutable
  public artifacts.
