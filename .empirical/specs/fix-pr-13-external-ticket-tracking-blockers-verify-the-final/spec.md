# Fix PR #13 External Ticket Tracking Blockers and Verify the Final Implementation

## Request

> Fix PR #13 external ticket tracking blockers, verify the final implementation, and run a new disposable live Linear recovery test without using the exposed credential.

## Goal

PR #13 provides a strict, target-confined, credential-safe external-ticket
mirror whose durable recovery state prevents blind duplicate creates after an
ambiguous provider response. The final branch passes all repository gates, and
a fresh disposable Linear test proves real lost-response recovery, projection,
and cleanup without exposing or retaining credentials.

## Acceptance Criteria

- [ ] [AC-1] The CLI and MCP tracker surfaces enforce the same strict, mode-discriminated `create` or `attach` bind contract: unknown or mode-incompatible fields fail before project discovery, provider traffic, or tracker-file mutation; the advertised MCP schemas expose the strict policy union (or `null`) and distinct bind branches; and configure, bind, and sync are identified as mutating operations.
- [ ] [AC-2] Before a provider create can be sent, Empirical durably records a secret-free prepared intent with its exact target, projection policy, marker, and stable attempt key, then durably marks that intent dispatched immediately before the request. Any unconfirmed post-dispatch outcome reports `TRACKER_CREATE_AMBIGUOUS`; automatic recovery performs only a bounded lookup for the exact attempt marker and never sends a second create. Zero matches, multiple matches, or malformed/incomplete pagination fail closed, while an explicitly confirmed duplicate-risk retry receives a new attempt key.
- [ ] [AC-3] A failed attach remains a durable retryable bind intent, and synchronization can finish that exact attach after credentials or provider availability return. An attach used to resolve an ambiguous create succeeds only when the selected ticket is inside the configured target and contains the exact original create marker; success retains the original attempt key, while a mismatch preserves the unresolved evidence and performs no replacement create.
- [ ] [AC-4] Provider failure never rolls back or advances authoritative local workflow state. If ticket creation produced a valid binding but the subsequent projection fails, Empirical retains that binding and reports ordinary pending or failed projection work rather than misclassifying the create as ambiguous.
- [ ] [AC-5] Bind, status, reconciliation, and synchronization validate provider, target digest, remote identity, and a credential-free provider URL before reuse. Target drift fails before network access, a same-target state-map change forces reprojection, provider responses cannot replace the bound identity, and GitHub mutation identifiers are re-derived from the configured issue and project instead of trusting persisted opaque identifiers.
- [ ] [AC-6] Tracker policy accepts only documented uppercase credential environment-variable names, resolves their nonblank values from the host at call time, and never persists a credential or authorization value. Failures from provider responses and injected transports are bounded and redact the exact runtime values before they can appear in pending records, status, Doctor output, or test artifacts.
- [ ] [AC-7] Structured and human tracker status/action output reports `local-only`, `pending`, `synced`, or `failed` with safe provider and URL data, committed, last-synchronized, and pending revisions, and bounded failure code, summary, timestamp, and recovery guidance where applicable. Status and Doctor make no provider request; Doctor validates dormant binding and pending records even when tracker policy is absent and leaves their bytes and Git state unchanged.
- [ ] [AC-8] GitHub, Linear, and Jira reconcile only one exact provider-owned create marker inside the configured target. GitHub excludes pull requests, requires complete issue and Projects v2 pagination, revalidates project membership, and mutates only an exact machine-owned comment block; Linear filters by team, validates optional project membership, and upserts one balanced marker while preserving human description text; Jira confines enhanced JQL results to the configured project and issue type, requires exact issue-property ownership and complete warning-free pagination, and writes valid ADF descriptions. Every adapter rejects malformed success data before persisting or acknowledging an invalid identity.
- [ ] [AC-9] The final tree passes `git diff --check`, TypeScript checking, the focused tracker/CLI/MCP/Doctor regressions, and the complete `bun run ci` gate including the full test suite, coverage threshold, distribution smoke test, package test, and consistency validation.
- [ ] [AC-10] Using only a newly supplied short-lived Linear credential from the host secret store, a disposable live test lets the real `issueCreate` request succeed and then simulates a lost local response. The initial bind reports durable ambiguity; the next sync finds the unique exact marker, binds the existing issue without another `issueCreate`, and subsequent state-map and completed-revision projections update that same issue.
- [ ] [AC-11] The live test observes exactly one disposable Linear issue and one exact Empirical create marker for the attempt, archives the issue, confirms it is archived, emits only safe identifiers and result summaries, and removes the temporary credential file and untracked harness after the run.
- [ ] [AC-12] Tracker Policy v1 remains a strict, independently versioned GitHub, Linear, or Jira union with a complete normalized state mapping and runtime credential-name grammar. Linear requires an explicit `projectId` key containing either a valid provider identifier or literal JSON `null`; provider-target changes cannot reinterpret an existing binding, while same-target mapping changes invalidate the prior projection acknowledgment.
- [ ] [AC-13] The installed `empirical` skill remains the only user-facing workflow entrypoint. Explore, discovery, setup, context, and tracker operations remain MCP, TypeScript, or private automation surfaces; concrete requests route directly, genuinely vague or explicitly interviewed requests use the approved five-pass contract, repository knowledge initializes through the same skill, and generated integrations, public help, documentation, and living specifications do not advertise removed dedicated skills or public workflow commands.

## Scope

- Strict tracker policy and bind validation at runtime, CLI, and MCP boundaries.
- Durable binding, prepared/dispatched create, attach, replacement, ambiguity,
  and projection recovery records.
- Provider target, identity, URL, pagination, and owned-marker validation for
  GitHub Issues + Projects v2, Linear, and Jira Cloud.
- Credential resolution, exact redaction, local status, and read-only Doctor
  diagnostics.
- Focused regression coverage, public documentation, living-capability
  alignment, complete CI, and one disposable live Linear fault-injection run.
- Single-skill discovery and initialization wording plus strict Tracker Policy
  v1 grammar and target/mapping authority boundaries affected by the PR cleanup.

## Non-goals

- Claiming an exactly-once guarantee from providers. If a dispatched create
  cannot be reconciled uniquely, Empirical fails closed; a user-confirmed new
  attempt may still create a duplicate and must state that risk.
- Using, validating, recovering, logging, or persisting the Linear token exposed
  in chat. That credential is treated as compromised and must be revoked; only
  a newly supplied short-lived secret may be used for the live test.
- Importing remote ticket state into Empirical, allowing remote status changes
  to advance local phases, or adding bidirectional synchronization.
- Discovering credentials, escalating provider permissions, replacing a target
  or binding implicitly, or deleting non-disposable provider data.
- Adding a browser UI, changing unrelated SDD workflow semantics, publishing a
  package release, or merging the pull request as part of verification.

## Risks

- A provider may accept a create while the client loses the response. Persist
  the attempt before dispatch, reconcile the exact marker, and fail closed on
  absence, collision, or incomplete pagination.
- Forged or stale local tracker records could redirect a mutation. Bind every
  record to the configured target, revalidate the remote ticket, derive mutable
  provider identifiers again, and suppress unsafe URLs from status.
- Provider errors or injected transports could echo authorization values. Pass
  runtime values only in memory, redact them before error construction or
  persistence, bound all responses and diagnostics, and inspect generated
  tracker artifacts for leaks.
- The live test could leave remote clutter or accidentally reuse production
  data. Use a uniquely marked disposable issue in an explicitly selected test
  team, count matching issues before cleanup, archive only that issue, and
  verify its archived state.
- The short-lived credential may lack the required team permissions. Stop with
  a clear blocked result and request a new securely scoped credential; never
  fall back to the exposed token or broaden access silently.

## Verification

- Run `git diff --check` and `bun run check` on the final source tree.
- Run `bun test tests/tracking.test.ts tests/cli-config.test.ts tests/mcp.test.ts tests/doctor.test.ts tests/trust-foundations.test.ts tests/integrations.test.ts --timeout 60000` and inspect the strict-input, ambiguity, confinement, redaction, owned-marker, malformed-pagination, public-schema, single-skill, private-surface, and read-only Doctor assertions.
- Run `bun run ci` after the final documentation and context refresh; retain the
  command result as evidence for the complete test, coverage, distribution,
  package, and consistency gates.
- Inject a newly requested `LINEAR_API_KEY` into only a temporary live-test
  process. Wrap the production transport so the first successful Linear
  `issueCreate` response is discarded locally, then assert ambiguity,
  exact-marker reconciliation, one create request, one matching issue, state
  reprojection, completed-revision projection, archive success, and no secret in
  stdout, stderr, repository files, or retained artifacts.
- Independently review the final diff for unsafe retry, stale provider identity,
  target escape, URL spoofing, incomplete pagination, and credential leakage
  before updating PR #13.

## Capability Deltas

- `deltas/external-ticket-tracking.md`: tighten the public contract, durable
  bind/create recovery, provider confinement and exact reconciliation, secret
  handling, and read-only observability.
- `deltas/project-policy.md`: make the tracker credential grammar, required
  Linear project selector, target drift, and mapping acknowledgment explicit.
- `deltas/exploratory-discovery.md`: keep discovery on the single user-facing
  skill and move direct Explore usage to agent/private surfaces.
- `deltas/repository-knowledge.md`: initialize repository knowledge through the
  single skill's setup and context operations.
