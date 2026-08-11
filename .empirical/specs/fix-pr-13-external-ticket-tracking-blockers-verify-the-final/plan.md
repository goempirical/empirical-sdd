# Plan: PR #13 External Ticket Tracking Hardening

1. Establish the contract and trust boundaries.
   - Record strict public input, durable recovery, target confinement,
     diagnostics, provider behavior, CI, and live Linear acceptance criteria.
   - Represent all living-capability changes as replayable deltas against the
     feature baseline.

2. Harden tracker core records and transitions.
   - Add strict runtime bind parsing and checksummed, target-bound binding and
     pending schemas.
   - Persist prepared create/attach intent, mark create dispatched before the
     request, and separate binding persistence from projection.
   - Resume safe prepared/attach work and reconcile dispatched creates without
     blind redispatch.
   - Associate replacement attempts with the binding they replace.

3. Constrain provider adapters and stored observations.
   - Implement bounded exact-marker reconciliation and fail-closed pagination
     for GitHub, Linear, and Jira.
   - Validate target membership, remote identity, provider URLs, warnings, and
     response envelopes before persistence or mutation.
   - Re-derive GitHub mutation identifiers, preserve human-authored Linear text,
     write Jira ADF, and redact runtime values from all bounded diagnostics.

4. Align public surfaces and local diagnostics.
   - Expose strict CLI/MCP schemas and mutating-operation metadata.
   - Render safe provider, URL, revision, failure, and recovery facts.
   - Validate dormant tracker files through read-only Doctor inspection.
   - Align documentation, the single installed skill contract, and living
     capability deltas.

5. Prove implementation behavior.
   - Run TypeScript, focused tracker, CLI, MCP, Doctor, trust, integration, and
     diff checks.
   - Obtain independent crash-recovery and security reviews and resolve every
     high/medium blocker.
   - Refresh generated repository context after the final source/spec tree.

6. Run the complete evidence gate.
   - Execute the policy-authorized `ci` command as immutable Empirical
     test/review evidence covering all 13 criteria.
   - Verify the final evidence report before completing implementation review.

7. Exercise Linear safely.
   - Accept only a fresh short-lived key through BB's secure prompt.
   - Discover safe team metadata, choose the intended demo/test team, and run a
     temporary production-transport harness that discards one successful create
     response locally.
   - Prove ambiguity, exact-marker recovery, one create, state-map reprojection,
     completion projection, and archival of the disposable issue.
   - Create a separate clearly named visible demo issue with the normal path,
     report its safe key/URL, and leave it for the user.
   - Remove the exact dotenv and harness files and retain only sanitized
     repository-contained evidence.

8. Integrate and deliver.
   - Replay and review the four capability deltas against an independent target.
   - Complete Empirical's context and integration gates.
   - Inspect the final diff, commit the intentional scope, push the existing PR
     branch, and wait for GitHub checks to pass.

