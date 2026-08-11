# Make Linear Tracker Descriptions Clean And Readable While Preserving Exa

## Request

> Make Linear tracker descriptions clean and readable while preserving exact crash-recovery reconciliation, migrate legacy HTML marker blocks, update the SDD-5 demo, verify the full suite, integrate, and deliver PR #13.

## Goal

Linear issues projected by Empirical display a compact, readable status summary
instead of raw HTML comments and SHA-256 recovery metadata, while the underlying
description retains exact, target-bound markers needed for safe crash recovery.

## Acceptance Criteria

- [ ] [AC-1] [UI] A newly created or synchronized Linear issue renders a compact
  Empirical status section with a readable phase, workflow status, revision, and
  completion level; literal HTML comment delimiters, raw create-attempt prose,
  and visible SHA-256 hashes do not appear in the rendered description.
- [ ] [AC-2] Linear description source retains one exact feature projection
  marker and one exact create-attempt marker in Markdown link destinations, so
  ambiguous-create reconciliation still finds only the original issue and never
  sends a second create automatically.
- [ ] [AC-3] Synchronizing an issue containing the legacy HTML projection and
  create-attempt blocks replaces them with the readable Markdown representation
  while preserving all human-authored text outside the managed blocks.
- [ ] [AC-4] Duplicate, mixed, malformed, or unbalanced legacy/new marker sets
  fail closed without overwriting user text or weakening exact-marker recovery.
- [ ] [AC-5] GitHub and Jira marker behavior remains unchanged, and focused
  regression tests plus the complete `bun run ci` gate pass.
- [ ] [AC-6] The existing SDD-5 Linear demo is synchronized through the hardened
  adapter, visibly contains the clean representation, and no temporary credential
  or harness remains afterward.
- [ ] [AC-7] PR #13 contains the verified changes and reports successful checks.

## Scope

- Linear-specific projection and create-recovery marker rendering and parsing.
- Migration of legacy Linear HTML blocks during the next synchronization.
- Regression, migration, reconciliation, and live-demo verification.
- Delivery of the completed branch to PR #13.

## Non-goals

- Changing the GitHub comment or Jira property representation.
- Changing local workflow authority, provider mappings, or ticket identity.
- Removing machine markers from Linear description source.
- Creating a replacement demo issue when SDD-5 can be migrated safely.

## Risks

- A prettier representation could break exact lost-response reconciliation.
- Loose migration parsing could consume human-authored content or accept a
  spoofed marker.
- Mixed old and new marker forms could create ambiguous mutation ownership.

## Verification

- Focused unit tests inspect Linear request bodies and legacy migration behavior.
- Existing crash-recovery tests prove one-create convergence remains intact.
- `bun run check`, focused tracker tests, `git diff --check`, and `bun run ci`.
- A securely authenticated live sync of SDD-5 followed by a read-only query that
  records only safe identifiers and presentation assertions.

## Capability Deltas

- `deltas/external-ticket-tracking.md` modifies the projection contract for
  readable Linear rendering and safe legacy migration.
