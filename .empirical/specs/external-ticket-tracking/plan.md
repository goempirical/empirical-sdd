# Plan: External Ticket Tracking

## 1. Establish tracker protocol and persistence

- Add strict Tracker Policy v1, provider target schemas, normalized progress
  states, feature binding, pending projection, tracker health, safe diagnostics,
  and transport types in `src/tracking.ts` and supported public type exports.
- Reuse canonical digests and contained atomic JSON writes; validate HTTPS URLs,
  environment-variable names, provider identity, feature paths, schema versions,
  and secret-free persisted shapes.
- Implement deterministic phase/status projection and stable idempotency keys.
- Add tests for missing-policy local-only behavior, strict invalid inputs,
  mapping, redaction, atomic persistence, and crash-gap reconstruction.

## 2. Implement provider reconciliation

- Implement a bounded default fetch transport plus injected transport support.
- Implement GitHub issue create/attach, Projects v2 add/item status mutation,
  marker-comment upsert, response validation, and safe retained identifiers.
- Implement Linear issue create/attach, marker-block upsert, workflow `stateId`
  update, GraphQL error handling, and response validation.
- Implement Jira REST v3 issue create/attach, issue-property upsert, available
  transition selection by destination status id, transition execution, and
  same-site URL validation.
- Test request sequences, missing authentication, HTTP/GraphQL errors,
  malformed responses, ambiguous create recovery, retries, and idempotent
  convergence without live network calls.

## 3. Compose tracking with the Empirical application service

- Add configure, bind, sync, and local status methods to `EmpiricalProject` with
  injectable transport/environment dependencies.
- Add tracker health to status, action, and explain packets without changing the
  persisted Schema-5 workflow state or allowing tracker input into transitions.
- Ensure bind/sync writes pending state before network effects and only advances
  acknowledgment after validated provider convergence.
- Prove a failed remote sync cannot roll back or block a committed completion,
  including terminal-compaction and retry cases.

## 4. Add granular MCP and private transport operations

- Register `tracker-configure`, `tracker-bind`, and `tracker-sync` in the frozen
  operation registry with exact read/write/idempotency annotations.
- Add strict MCP schemas and handlers; update server instructions and registry
  parity checks.
- Add private internal CLI parsing/rendering only as the agent fallback while
  keeping public lifecycle command discovery unchanged.
- Extend MCP, CLI, built smoke, and clean-consumer tests for the three operations
  and tracker-aware packets.

## 5. Contract the user-facing skill registry to one

- Keep only the `empirical` definition in `SKILLS` and update its generated body
  to own setup, Socratic discovery, routing, normal/YOLO execution, handoff,
  tracker configuration/synchronization, and exact terminal reporting.
- Remove unused dedicated skill bodies and make installation paths/counts derive
  from the one registry definition.
- Extend the obsolete managed list with Init, Spec, Socratic, Loop, YOLO, and
  prior Explore/Fast/Complex names across all supported roots.
- Update install/update/uninstall and catalog tests to prove safe repeatable
  cleanup and preservation of unmanaged collisions.

## 6. Update diagnostics and documentation

- Add read-only Doctor checks for tracker policy/binding/pending integrity and
  credential-variable presence without revealing values or contacting providers.
- Update README, architecture, protocol, MCP, security, demo, context pages, and
  consistency scripts to describe one skill, granular MCP internals, one-way
  tracking, provider environment variables, retry semantics, and local-only
  compatibility.
- Keep package exports narrow and verify no tracker secret or generated output
  enters the package unexpectedly.

## 7. Verify and repair

- Run focused tracker, core, integrations, MCP, CLI, doctor, and distribution
  tests while implementing.
- Run `bun run ci` through Empirical's configured evidence executor for AC-1
  through AC-19 and retain the immutable receipt.
- Inspect the complete diff against the accepted decisions and criteria; repair
  failures without weakening the contract.
- Run `git diff --check` and confirm the worktree contains no credentials,
  transient provider responses, build output, or unrelated changes.

## 8. Review and integrate living specifications

- Complete Verify only with the passing configured receipt.
- Complete Review only after criterion-by-criterion diff and accepted-decision
  alignment; reuse or collect the required review evidence receipt.
- Integrate `external-ticket-tracking`, `agent-integrations`, and
  `project-policy` deltas against an independent target worktree, then report the
  exact highest completion level.
