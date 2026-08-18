# Plan: Tracker Onboarding and Rich Lifecycle Synchronization

## 1. Establish Policy v2 and provider-neutral contracts

- Extend tracker types in `src/types.ts` with Policy v1/v2 branches, effective
  policy metadata, discovery resources/capabilities, mapping candidates and
  preview, tracker setup changes, artifact descriptors, and effect
  acknowledgements.
- Refactor schemas in `src/tracking.ts` to parse strict v1 and v2 policies,
  normalize v1 conservatively, and keep current v1 binding/pending records
  readable without rewriting them.
- Include ticket behavior and visibility in projection-policy digests while
  preserving target digest compatibility.
- Export the new contracts from `src/index.ts`.
- Add focused policy tests for strictness, secret rejection, v1 byte
  preservation, v2 round-trip, and disabled/off zero-network behavior.

## 2. Implement discovery, mapping, validation, and preview

- Add strict provider-discriminated discovery inputs and a common bounded result
  shape in `src/tracking.ts`.
- Implement Linear, GitHub Projects, and Jira discovery using the current
  injectable bounded transport, complete pagination, safe URL/identity checks,
  target hierarchy validation, and credential redaction.
- Implement a pure seven-phase mapping engine. Rank provider semantics/type and
  position first, compatible names second, allow shared states, and return
  unresolved ties as ambiguity.
- Implement preview and apply-time validation that expands target display names,
  verifies every mapped state belongs to the selected target, and refuses
  permission loss, partial discovery, or ambiguity before writing policy.
- Cover conventional Linear workflows, simple boards, localized names, ties,
  invalid parents, permission errors, malformed pages, repeated cursors, and
  all provider result kinds in `tests/tracking.test.ts`.

## 3. Expose setup through Init, core, CLI, registry, and MCP

- Add `tracker-discover` and `tracker-preview` operations to
  `src/operations.ts`, with correct read-only/mutating annotations and parity
  assertions.
- Add `EmpiricalProject` methods and extend `InitOptions` with an optional
  preserve/disabled/apply tracker change. Apply it only after ordinary project
  initialization is valid; absence preserves existing bytes.
- Register strict MCP schemas and handlers in `src/mcp.ts`; extend Init and
  configure schemas with the same tracker setup contract.
- Extend `src/setup.ts` summary data and `src/cli.ts` interactive configuration
  to render a Tracker section, discover/select by display name, edit the complete
  mapping, select ticket/visibility policies, preview, and explicitly save.
- Keep non-interactive private CLI JSON paths equivalent and ensure cancel/
  failed validation changes neither project configuration nor tracker policy.
- Update CLI/setup/MCP tests for preserve, local-only, provider apply, strict
  schema discrimination, previews, and secret-free rendered/stored output.

## 4. Add automatic ensure binding and ambiguity recovery

- Normalize manual/off/ensure behavior before credential resolution in
  `trackerStatus`, `bindTracker`, and `synchronizeTracker`.
- Generalize the stable bind marker to a target-bound feature marker and add
  adapter-specific bounded `findByFeatureMarker` behavior.
- In ensure mode, validate a durable/reference ticket when present, reconcile
  the stable marker, create only on a complete zero-match result, and persist
  intent plus dispatch before network effects.
- Persist bounded ambiguity facts for multiple candidates or incomplete
  reconciliation and make retry reuse the exact marker without sending a
  dispatched create again.
- Test referenced attach, one-match reconciliation, zero-match create,
  multiple-match stop, lost create responses, credential failures, and retry
  from every durable boundary for Linear, GitHub, and Jira.

## 5. Project milestone history with per-effect idempotency

- Extend projections with committed summary, blocker, receipt IDs/digest, and
  previous acknowledged phase/status/completion metadata.
- Implement visibility eligibility for blockers/final, phase milestones, and
  every revision.
- Replace the single pending completion state with a backward-compatible effect
  ledger covering transition, comment/activity, and artifacts. Generate stable
  feature/revision/receipt digest keys and acknowledge each effect atomically.
- Implement provider comment/activity operations with exact owned markers and
  reconciliation: Linear `commentCreate`, GitHub issue comments, and Jira
  comments/properties.
- Stop new Linear lifecycle projection from updating descriptions; retain legacy
  marker parsing for Policy v1 create/attach/recovery only.
- Test milestone content, visibility counts, repeated sync, partial comment
  failure, provider outage, same-revision policy changes, and byte-for-byte
  preservation of user-authored descriptions.

## 6. Add bounded evidence artifact projection

- Read and digest only receipt IDs already committed in workflow state; validate
  receipt schema/digest and collect artifact paths without trusting arbitrary
  tracker input.
- Resolve repository containment and reject symbolic links, non-regular/missing
  files, secret-like names, unsafe media types, digest drift, excessive counts,
  and byte limits before adapter invocation.
- Advertise adapter upload/link capabilities. Implement safe native upload or
  durable link behavior where supported and a bounded capability omission where
  not supported; never persist artifact bytes or credential values.
- Persist artifact effect keys and remote acknowledgement metadata so retries
  cannot duplicate a successful upload/link.
- Test screenshots, links, unsupported providers, symlink escapes, secret-like
  paths, oversized files, upload failure after comment success, and credential
  redaction.

## 7. Complete observability, Doctor, migration, and documentation

- Extend tracker status/human rendering with schema compatibility, ticket
  behavior, visibility, pending effect counts, and distinct ambiguity,
  permission, artifact, and outage recovery hints.
- Extend Doctor's local-only validation to v2 policies and v1/v2 dormant
  bindings/pending/effect ledgers without provider calls or repairs.
- Update `README.md`, `docs/protocol.md`, `docs/mcp.md`, `docs/architecture.md`,
  `docs/security.md`, and migration guidance with interactive/non-interactive
  setup, provider credential variables/permissions, mapping edits, v1 behavior,
  ensure recovery, visibility, evidence safety, and outages.
- Refresh repository context pages and package/operation consistency assertions.

## 8. Verify and integrate

- Run focused tracking, setup, CLI config, MCP, Doctor, migration, and
  consistency suites during implementation.
- Run the configured type-check, full test, build/distribution smoke, package,
  and consistency evidence commands; record immutable receipts against all 15
  acceptance criteria.
- Refresh and refine repository knowledge until Context reports no stale,
  missing, or refinement-required topics.
- Complete Verify and Review with independent review evidence, repair any
  failures within the configured limit, then integrate the reviewed
  `external-ticket-tracking` delta against an independent target worktree.
- Report the exact highest proven completion level; do not deliver, publish, or
  mutate the external Linear issue without separate authorization.
