# Versioning and changelog policy

Empirical SDD uses [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html)
and maintains [CHANGELOG.md](../CHANGELOG.md) in the
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) format.

## Alpha compatibility

Versions below `1.0.0` are alpha releases. During alpha:

- PATCH versions contain backward-compatible corrections and documentation or
  packaging fixes that do not change the public workflow contract.
- MINOR versions contain additive features or breaking public workflow,
  integration, state, or package-surface changes. Every breaking alpha minor
  must include an explicit migration note.
- `1.0.0` will declare the first stable compatibility contract. After that,
  ordinary SemVer major, minor, and patch meanings apply without the alpha
  exception.

## Canonical version

`PRODUCT_VERSION` in `src/protocol.ts` is the canonical product version.
`package.json`, public CLI output, package smoke checks, tests, documentation,
and the prepared changelog heading must match it. `SCHEMA_VERSION` changes only
when durable state compatibility changes; a package version change does not
imply a schema change.

The prepared `0.26.1` release is an alpha PATCH: it corrects global updater
verification so npm-prefix and PATH-visible executables cannot diverge behind a
false success report. Schema 5, Tracker Policy v1/v2, workflow behavior, and the
package surface remain compatible, and existing repositories require no state
migration.

## Changelog rules

Every user-observable change starts under `Unreleased` using applicable Keep a
Changelog categories: Added, Changed, Deprecated, Removed, Fixed, Security, or
Migration. Release preparation moves those entries into a dated version
heading and updates compare links. Historical entries must be grounded in
repository tags and commits rather than reconstructed marketing claims.

Breaking alpha changes require a `Migration` section that states exactly what
existing users or repositories must do. Internal refactors with no observable
effect may be omitted unless they materially affect trust or maintenance.

## Preparation checklist

Preparing a version requires all of the following:

1. Classify the change as alpha patch or minor and record migration guidance
   for any breaking behavior.
2. Update `PRODUCT_VERSION`, package metadata, version-sensitive checks, and the
   dated changelog heading while leaving the schema untouched unless state
   compatibility actually changed.
3. Run type checking, tests, coverage, built-distribution smoke tests, clean
   package-consumer checks, consistency checks, and `git diff --check`.
4. Inspect `npm pack` contents and confirm `CHANGELOG.md` and this policy ship in
   the package.
5. Review the complete diff and record immutable Empirical evidence.

## Publication boundary

Version preparation is a local repository change. It does not authorize a Git
tag, GitHub release, npm publication, dist-tag update, protected-branch merge,
or remote ticket mutation.

Publication remains a separate explicit Empirical operation. It requires the
exact package, semantic version, commit, tag, dist-tag, literal approval, and an
authorization bound to that complete request. Existing conflicting immutable
remote state blocks publication instead of being replaced.
