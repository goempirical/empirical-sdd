# Decisions: Fix Pr 13 External Ticket Tracking Blockers Verify The Final

Record concise, externally reviewable evidence and choices here. Do not store
private chain-of-thought, prompts, credentials, secrets, or scratchpad text.

## D-001: Select the implementation approach

Status: Accepted

### Evidence

- PR review reproduced blind duplicate-create windows, target drift, untrusted
  persisted provider identifiers, incomplete public schemas, credential leakage
  from injected transports, and missing dormant-record diagnostics.
- The local journal must stay authoritative when provider requests fail.
- GitHub, Linear, and Jira expose different reconciliation and pagination
  primitives, and none supplies a universal exactly-once create guarantee.
- The user requires a real Linear demonstration but the credential previously
  pasted in chat is compromised and cannot be used.

### Options

1. Retry failed creates directly and rely on provider behavior or local request
   hashes to avoid most duplicates.
2. Persist a pre-dispatch intent and reconcile an exact provider-visible marker
   after every ambiguous post-dispatch outcome.
3. Require manual attachment after every create error and provide no automatic
   reconciliation.

### Chosen approach

Use option 2. Persist a stable, secret-free attempt before dispatch; separate
prepared and dispatched phases; bind only a unique exact-marker match inside the
configured target; and require explicit duplicate-risk confirmation for a new
attempt when reconciliation is inconclusive. Bindings pin target and policy
identity, and provider mutation identifiers are re-derived from validated
remote state.

### Trade-offs and risks

- Reconciliation adds provider-specific queries and pagination complexity, but
  bounds, exact matching, and fail-closed parsing keep uncertainty observable.
- Exactly-once creation cannot be promised; zero or duplicate matches remain
  ambiguous and a confirmed new attempt can create a duplicate.
- Persisted local records are untrusted repository content, so every reuse must
  validate checksums, target, identity, and safe URL before network mutation.
- Live verification creates remote data. A disposable issue is uniquely marked,
  archived, and verified; a separate demo issue is retained only because the
  user explicitly requested a visible demo.

### Verification

- Regression tests exercise prepared/dispatched recovery, exact-marker match,
  zero/collision/malformed pagination, replacement association, stage-separated
  projection failure, target drift, forged IDs/URLs, and exact redaction.
- Independent crash-recovery and security reviews must report no high/medium
  blocker.
- Full CI must pass from the final tree.
- A fresh-secret Linear run must prove one remote create, recovery of that same
  issue after a simulated lost response, subsequent projections, and confirmed
  archival of the disposable issue.

## D-002: Keep live authorization ephemeral

Status: Accepted

### Evidence

- A Linear token was pasted in chat and must be treated as exposed.
- Empirical policy persists only an environment-variable name.

### Options

1. Reuse the pasted token for convenience.
2. Ask the user to paste another token into chat or a shell command.
3. Request a fresh short-lived key through BB's secure secret prompt and inject
   it only into the live process.

### Chosen approach

Use option 3. Never read or print the dotenv file. Source it only into the live
test process, inspect only sanitized result data, then delete the exact dotenv
and harness paths.

### Trade-offs and risks

The run pauses for secure user input and may be blocked by insufficient Linear
scope. It never falls back to the exposed token or silently broadens access.

### Verification

Confirm the secret request reports a completed write, the harness output contains
only safe identifiers, repository scans contain no credential, and the exact
temporary files are absent after cleanup.
