# Decisions: External Ticket Tracking

Record concise, externally reviewable evidence and choices here. Do not store
private chain-of-thought, prompts, credentials, secrets, or scratchpad text.

## D-001: Keep Empirical authoritative and synchronize after commit

Status: Accepted

### Evidence

- Schema-5 workflow mutations already use exact revisions, hash-linked journal
  events, and atomic state projections.
- The user selected the one-way mirror model explicitly.
- Remote APIs can time out or return ambiguous failures after accepting a
  request; including them inside the workflow transaction would make local
  truth depend on an effect that cannot be rolled back reliably.

### Options

1. Let the external board drive Empirical state through polling or webhooks.
2. Put remote requests inside the local state transaction and fail the phase
   when the board is unavailable.
3. Commit Empirical first, persist a deterministic outbound projection, and
   reconcile it independently with retries.

### Chosen approach

Choose option 3. Empirical alone advances SDD state. Tracker synchronization is
a separate granular operation over durable pending data and can report failure
without reverting or blocking the committed revision.

### Trade-offs and risks

- The external board is eventually consistent rather than transactionally
  current.
- A process can stop between local commit and pending-file creation; status and
  sync repair the gap from the committed revision plus binding.
- Ambiguous ticket creation must not be retried blindly. Reconcile the stable
  feature marker first and require explicit confirmation before a fresh create.

### Verification

Inject a provider failure after an exact local completion, assert the revision
and journal remain advanced, assert tracker health is pending/failed, then retry
the same projection and prove one logical remote update and synchronized health.

## D-002: Use independently versioned tracker policy and feature records

Status: Accepted

### Evidence

- Existing Schema-5 project and workflow schemas are strict and are already
  deployed in committed repositories.
- Tracking is optional and has a natural absence-as-local-only default.
- Provider targets, bindings, and retry metadata evolve independently from
  workflow state and must survive terminal journal compaction.

### Options

1. Bump the complete Empirical repository schema and embed provider data in
   every workflow state event.
2. Store provider configuration and feature synchronization state in strict,
   independently versioned tracker documents.
3. Keep configuration only in process memory or agent prompts.

### Chosen approach

Choose option 2. Store strict `.empirical/tracker.json` Policy v1 and contained
per-feature binding/pending files. Missing files remain valid local-only state;
no workflow migration prompt or secret-bearing configuration is introduced.

### Trade-offs and risks

- Tracker metadata is not itself part of the workflow hash chain; it has its
  own canonical digests and atomic writes.
- Status must combine authoritative workflow state with local tracker records.
- Corrupt tracker records must degrade tracker health without making the SDD
  state unreadable or encouraging silent repair.

### Verification

Open untouched Schema-5 fixtures, malformed/unknown-version tracker fixtures,
terminal compacted features, and interrupted pending fixtures. Prove local-only
compatibility, strict rejection, bounded failure reporting, and recovery.

## D-003: Normalize intent but keep provider identifiers explicit

Status: Accepted

### Evidence

- GitHub Projects v2 status is a single-select field option; Linear updates an
  issue with a workflow `stateId`; Jira issue editing does not perform workflow
  transitions and its transition endpoint is distinct.
- Names such as “Review” or “Done” are user-configurable and cannot be assumed
  to identify the same provider-native state.
- All three providers can be exercised through HTTP/GraphQL with injected
  transports and strict response checks.

### Options

1. Hard-code English status names and attempt fuzzy matching remotely.
2. Expose each provider directly to core workflow code.
3. Define seven normalized Empirical progress states, require explicit
   provider-native ids, and hide provider request differences behind one
   reconciliation contract.

### Chosen approach

Choose option 3. Core projects exact state into a normalized record. Strict
provider policy maps that record to GitHub option ids, Linear state ids, or Jira
destination status ids, and adapters implement provider-specific effects.

### Trade-offs and risks

- Initial configuration requires users to supply provider ids rather than only
  friendly names.
- Jira may not expose a direct transition to a configured destination from the
  current state; that remains a safe pending failure instead of guessed routing.
- Provider API changes remain localized to adapters, fixtures, and documented
  endpoints.

### Verification

Snapshot normalized mappings for every Empirical phase/status combination and
record provider requests for create, attach, marker upsert, and status movement.
Reject incomplete mappings and malformed responses before acknowledgment.

## D-004: Keep one human skill over granular MCP operations

Status: Accepted

### Evidence

- The current operation registry already separates exact Init, Discovery,
  routing, workflow, evidence, integration, delivery, and lifecycle behaviors.
- Six generated skills duplicate routing and approval guidance while the user
  prefers one `$empirical` entrypoint.
- Safe installation and uninstall already recognize marker-owned content and
  derive generated files from a shared skill registry.

### Options

1. Add three provider-specific skills to the existing six-skill surface.
2. Remove granular operations and create one broad MCP tool.
3. Register one user-facing `empirical` skill while retaining narrow MCP tools,
   including tracker configure/bind/sync, as its machine protocol.

### Chosen approach

Choose option 3. Contract the global skill registry to one and make its generated
instructions own the full journey. Keep granular MCP schemas, annotations,
revision gates, and private fallback transport for safety and testability.

### Trade-offs and risks

- The single skill body becomes more capable and must remain internally
  consistent with the operation registry.
- Older managed skills must be removed across many agent roots without touching
  unmanaged collisions.
- Advanced users lose separate named skills but retain the same operations
  through the automatic skill and MCP clients.

### Verification

Assert one registry skill, one generated managed file per selected unique root,
safe cleanup of every obsolete managed name, preservation of unmanaged files,
MCP parity for all operations, and help/docs/package consistency.
