# Plan: Prepare and Publish 0.27.0

1. Confirm immutable release identity and repository state.
   - Verify upstream repository/default branch, latest release, npm `latest`,
     absence of `v0.27.0` and `empirical-sdd@0.27.0`, authenticated fork, and
     absence of a matching PR.
   - Fetch current upstream `main`, inspect its divergence from the feature
     base, and confirm every dirty path belongs to the integrated feature or
     this release workflow.
2. Reconcile upstream and prepare aligned release sources.
   - Incorporate current upstream `main` without stash, force, or destructive
     reset.
   - Change `PRODUCT_VERSION`, `package.json`, help/smoke/consumer assertions,
     version-sensitive tests, lifecycle publication fixtures, and demo heading
     to `0.27.0`, leaving Schema 5 unchanged.
   - Move the human-first tracker entry into the dated `0.27.0` changelog,
     update compare links, and record alpha-MINOR/no-migration guidance in the
     versioning policy.
3. Verify source scope and candidate quality.
   - Inspect staged and unstaged paths and the complete diff; scan candidate
     text and package metadata for credential-shaped leakage without printing
     any value.
   - Run focused tracker/release checks and the configured full `bun run ci`
     command as immutable test evidence.
   - Run `npm pack --dry-run --json`, validate identity and intended contents,
     and collect the JSON result as package evidence.
   - Remove only generated coverage/package scratch after evidence collection.
4. Refresh context, review, and integrate.
   - Refresh repository knowledge until no stale, missing, invalid, or
     refinement-required pages remain.
   - Review AC-1 through AC-9 and accepted decisions against the full diff;
     record immutable review evidence with no unresolved findings.
   - Replay source and package-distribution delta against an independent clean
     checkout of current upstream `main`, run Policy v2 verification there,
     and retain the integration receipt.
5. Deliver through protected GitHub flow.
   - Give Empirical only the confirmed source paths, commit message, non-draft
     cross-repository PR title/body, authenticated fork branch, and upstream
     `main` target.
   - Push without force, create/reuse the source PR, wait for all configured
     matrix checks, and normally merge it.
   - Commit the immutable integration/evidence paths separately, create/reuse
     the required evidence PR, wait for checks, and normally merge it.
   - Confirm the delivery receipt's evidence merge SHA is current upstream
     `main` and capture the exact PR/revision URLs.
6. Cross the explicit immutable publication boundary.
   - Reinspect tag, release, npm version, dist-tag, and final evidence merge.
   - Bind literal approval to package `empirical-sdd`, version `0.27.0`, tag
     `v0.27.0`, dist-tag `latest`, and the exact evidence merge SHA.
   - Invoke Empirical publication once, then monitor the trusted GitHub npm
     workflow; retry only an identical authorization if asynchronous state is
     still converging.
7. Verify and report the public release.
   - Confirm tag and GitHub release resolve to the authorized merge, the publish
     workflow succeeded, npm exposes `0.27.0`, and `latest` equals `0.27.0`.
   - Report PRs, merge SHA, release URL, npm identity, verification results, and
     exact highest Empirical completion level.
