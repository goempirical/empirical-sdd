# Plan: Release 0.26.0

1. Confirm release identity and absence.
   - Verify remote `main`, latest tags/releases, npm version, and npm dist-tags.
   - Confirm `0.26.0` is absent and the working tree contains the completed
     concise ticket-policy feature on top of `v0.25.0`.
2. Prepare aligned release sources.
   - Change `PRODUCT_VERSION`, `package.json`, version-sensitive tests and
     package smoke assertions, and the demo heading to `0.26.0`.
   - Update the versioning note for this alpha MINOR while retaining Schema 5.
   - Move Unreleased changes into the dated `0.26.0` changelog section, include
     no-migration guidance, and repair compare links.
3. Inspect and verify the candidate.
   - Review the complete diff and scan tracked/untracked candidate content for
     credential-shaped leakage without printing values.
   - Execute the configured full `ci` command as immutable test/review evidence.
   - Run and collect `npm pack --dry-run --json` as artifact evidence.
4. Complete Empirical review and integration.
   - Record a criterion-by-criterion review with receipt bindings.
   - Replay the reviewed delta against an independent current `origin/main`
     checkout and run the same complete policy gate.
5. Deliver through protected GitHub flow.
   - Commit the release source and pre-delivery Empirical artifacts.
   - Ask Empirical to create, check, and normally merge the source PR.
   - Commit immutable integration/evidence artifacts separately, then create,
     check, and normally merge the evidence PR.
   - Confirm the five configured GitHub Actions jobs are green and retain the
     delivery receipt's final evidence merge SHA.
6. Cross the explicit publication boundary.
   - Re-inspect `v0.26.0`, GitHub release state, npm `0.26.0`, and `latest`.
   - Present the exact package, version, dist-tag, and evidence merge SHA and
     obtain literal commit-bound approval.
   - Create a digest-verified publication authorization and invoke Empirical's
     immutable publication operation.
   - Monitor the trusted GitHub npm workflow; if necessary, retry only the
     identical authorization after partial state converges.
7. Verify and report the public release.
   - Re-query remote tag, GitHub release, npm version, and `latest` independently.
   - Verify the Empirical publication receipt and report exact URLs, SHAs, test
     results, and the highest completion level.
