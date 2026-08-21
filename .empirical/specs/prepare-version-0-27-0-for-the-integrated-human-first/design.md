# Design: Prepare and Publish 0.27.0

## Release identity

The candidate is the alpha MINOR `empirical-sdd@0.27.0`, tag `v0.27.0`, npm
dist-tag `latest`, and a non-prerelease GitHub release in
`goempirical/empirical-sdd`. `PRODUCT_VERSION` remains the canonical source;
Schema 5 and Tracker Policy v1/v2 stay compatible. The behavioral payload is
the already integrated human-first tracker milestone renderer and recovery
logic.

## Upstream reconciliation

The feature work started at `dc0df32`, while protected upstream `main` has since
advanced to the `0.26.1` release-preparation merge. Fetch upstream directly,
incorporate it without stashing, force, or replacement, and require the release
head to contain the current upstream commit before delivery. Only the confirmed
human-first feature, its Empirical artifacts, upstream reconciliation, and
release-preparation paths belong in the source commit.

## Version surface

Change `PRODUCT_VERSION`, `package.json`, CLI/help and clean-consumer
assertions, smoke scripts, version-sensitive tests, and demo heading from
`0.26.1` to `0.27.0`. Update lifecycle publication fixtures after upstream
reconciliation. Replace the release-specific note in `docs/versioning.md` with
an alpha-MINOR explanation that calls out the additive tracker behavior and no
migration. Move the Unreleased changelog entry into a dated `0.27.0` section,
retain an empty Unreleased heading, and update compare links.

Generated repository context is refreshed only through the Context phase. The
Schema version, dependency graph, package exports, tracker cadence, and release
workflow remain unchanged.

## Verification and package inspection

The configured `ci` command is the primary immutable test/review receipt. It
covers type checking, the complete serialized suite and coverage floor, built
distribution smoke, a clean packed consumer, consistency, and whitespace. A
separate `npm pack --dry-run --json` artifact proves package identity and file
surface. Generated coverage output is removed after collection so it cannot
contaminate the candidate tree.

Independent integration replays the source and package-distribution delta onto
a clean checkout of current upstream `main` and runs the same policy command.

## Protected delivery

Empirical's delivery contract owns Git and GitHub mutations. It creates an
intentional source commit, pushes the fork branch without force, opens a
non-draft cross-repository source PR, waits for the full configured Actions
matrix, and requests a normal merge. It then commits immutable integration and
verification artifacts on an evidence branch, opens the required evidence PR,
waits for checks, and normally merges it. The evidence merge SHA is the only
eligible release commit.

Existing matching branches or PRs are reused. Any mismatched remote state,
failed check, branch-protection rejection, or ambiguous merge result stops
without admin bypass or replacement.

## Immutable publication

Before publication, inspect the exact evidence merge commit, absence or exact
identity of tag/release/package, and current `latest`. Publication requires the
literal approved version, commit, package, tag, and dist-tag bound by digest.
Create the annotated tag and GitHub release only through Empirical's exact
operation. The existing trusted GitHub Actions workflow publishes npm through
OIDC; no npm token is handled locally.

Because hosted npm publication is asynchronous, observe the release workflow
and retry only the identical authorized operation if it initially reports a
partial state. Postflight must show tag and GitHub release on the evidence merge
and npm version plus `latest` on `0.27.0`. Conflicting immutable state is never
deleted, moved, or overwritten.

## Traceability

- AC-1/AC-2: version-surface diff, consistency tests, and changelog review.
- AC-3: configured `ci` execution receipt.
- AC-4: `npm pack --dry-run --json` receipt and clean-consumer CI.
- AC-5/AC-6: Empirical delivery receipt and GitHub check conclusions.
- AC-7/AC-8: publication authorization, receipt, workflow, tag/release, and npm
  postflight inspection.
- AC-9: upstream ancestry, scoped status/diff, and independent integration
  receipt.

