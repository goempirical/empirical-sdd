# Concise Ticket Policy

## Request

> Implement a selectable concise interaction mode across the Empirical CLI, MCP/agent harness, and demo/test harness. In concise mode ask only material questions and render compact setup/runtime summaries. Add policy-driven ticket requirements with a recommended preset: every feature requires a linked ticket; fast/small fixes may proceed without one; complex/large fixes require one; chores do not require one. Required work with no referenced ticket must validate a reference, reconcile the stable marker, or create exactly one ticket without redundant questions. Optional work with no ticket proceeds locally. Add a safe provider-independent executable demo for starting a new feature with no ticket, preserve the current detailed mode and existing Tracker Policy v1/v2 behavior, and update complete tests, capabilities, and documentation.

## Goal

Let teams select a compact Empirical interaction style and express when a
feature, fix, or chore needs an external ticket without turning every change
into ceremony. The recommended policy requires tickets for features and
material fixes, permits small fixes and chores to remain local, and resolves a
missing required ticket exactly once through the existing safe tracker state
machine.

## Acceptance Criteria

- [ ] [AC-1] Project configuration supports `concise` and `detailed` question
  modes. New recommended setup selects `concise`, while an existing Schema-5
  config with no interaction field normalizes to `detailed` and keeps its
  current behavior.
- [ ] [AC-2] Interactive setup, non-interactive CLI flags, MCP init/configure
  inputs, action packets, status output, and generated agent guidance expose
  the same effective question mode. Concise mode renders short summaries and
  instructs agents to ask only an exact material question; detailed mode keeps
  the existing expanded guidance.
- [ ] [AC-3] Tracker Policy v2 accepts an optional strict `ticketRules` matrix
  over `feature`, `fix`, and `chore` crossed with `fast`, `quick`, and
  `complex`. The recommended preset resolves every feature to `required`, a
  fast fix to `optional`, quick/complex fixes to `required`, and every chore to
  `optional`.
- [ ] [AC-4] Ticket requirement resolution uses the persisted workflow profile
  and the same deterministic change-type classifier used by worktree routing,
  is returned in tracker status, and is identical through core, CLI, MCP, and
  agent-harness surfaces.
- [ ] [AC-5] Required work with no binding validates one referenced ticket when
  present, otherwise reconciles the stable feature marker and creates exactly
  once only when no unique ticket exists. Multiple references or candidates
  fail closed without guessing or duplicating a ticket.
- [ ] [AC-6] Optional work with no binding attaches one valid explicit request
  reference but, when no reference exists, proceeds locally without resolving
  credentials, searching the provider, creating a ticket, or asking a
  redundant question. A custom `off` rule performs no provider access.
- [ ] [AC-7] Tracker Policy v1 and every v2 policy without `ticketRules` retain
  their existing manual/off/ensure semantics and remain byte-preserved during
  repair. Strict validation rejects incomplete matrices, unknown keys, and
  rules combined with non-ensure ticket behavior.
- [ ] [AC-8] A packaged provider-independent demo starts a new Complex feature
  with no ticket, drives the real ensure/reconcile/create path through a mock
  adapter, and proves that exactly one remote ticket becomes bound without
  reading host credentials or contacting a live provider.
- [ ] [AC-9] The package/demo harness executes the new demo, generated local
  skills carry concise-mode and ticket-rule guidance, documentation shows the
  preset and custom JSON forms, and focused plus complete CI verification
  passes.

## Scope

- Backward-compatible Schema-5 project configuration for question mode.
- Backward-compatible Tracker Policy v2 rule matrices and deterministic
  requirement resolution.
- Core synchronization behavior for required, optional, and off work.
- CLI setup/configuration/rendering, MCP schemas and action packets, and
  generated repository-local agent guidance.
- A mock-provider executable demo, packed-consumer harness coverage,
  capability contracts, and user documentation.

## Non-goals

- Changing provider authentication, secret handling, local-journal authority,
  tracker state mappings, visibility rules, or remote-to-local directionality.
- Guessing ticket identity, accepting duplicate creates, or making a live
  Linear/GitHub/Jira mutation in the demo.
- Requiring a ticket for small fixes or chores under the recommended preset.
- Removing the detailed interaction mode or rewriting existing tracker policy
  files during repair.
- Assigning a remote ticket to a person; this feature governs whether work is
  linked to a ticket, not provider-specific ownership fields.

## Verification

- Unit-test configuration normalization, setup rendering, CLI flags, MCP
  schemas, action packets, and generated skills in both modes.
- Unit-test strict rule parsing and every recommended matrix cell across
  feature/fix/chore and fast/quick/complex.
- Exercise required attach/reconcile/create, optional reference attach,
  optional no-reference zero-I/O, off zero-I/O, and ambiguity/idempotency paths
  with deterministic mock transports.
- Build and execute the packaged no-ticket demo through the clean-consumer
  harness and validate its structured output.
- Run type checking, focused tests, `bun run ci`, package inspection,
  consistency checks, and `git diff --check`.

## Capability Deltas

- `deltas/project-policy.md` adds the backward-compatible question-mode
  configuration and packet contract.
- `deltas/ticket-requirement-policy.md` adds type/profile ticket rules and
  required/optional resolution semantics.
- `deltas/agent-integrations.md` makes the selected mode and ticket decision
  effective in generated harness guidance and packaged demo verification.
