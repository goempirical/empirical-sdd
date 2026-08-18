# Canonicalize Tracker Artifact Root Plan

1. Add an aliased-root tracker regression that creates and completes approved
   evidence through the alias and reaches Jira attachment recovery.
2. Confirm the regression fails with the current lexical-root resolution.
3. Resolve receipt-relative artifacts from `canonicalRoot` during both
   projection eligibility and the final pre-upload reread without changing
   other safety checks.
4. Run the focused tracker test file and inspect the source/test diff.
5. Run complete repository CI and record immutable verification evidence.
6. Review the fix against the acceptance criteria and integrate the capability
   delta against an independent clean target.
7. Commit only `src/tracking.ts` and `tests/tracking.test.ts`, fast-forward the
   existing PR source branch, update the exact Empirical marker, and wait for
   all GitHub Actions jobs.
