# Ticket Requirement Policy Specification

## Purpose

Decide whether work needs a remote ticket from its deterministic change type
and workflow size while preserving the existing optional one-way tracker.

## Requirements

### Requirement: Ticket requirements follow change type and workflow size

Tracker Policy v2 MAY contain a strict `ticketRules` matrix with exactly the
change types `feature`, `fix`, and `chore`, each containing exactly the profiles
`fast`, `quick`, and `complex`, whose values are `required`, `optional`, or
`off`. Rules are valid only with ticket behavior `ensure`. Empirical SHALL
resolve the active rule using the persisted workflow profile and the same
deterministic request classifier used for worktree change types. The resolved
change type and requirement MUST be visible in secret-free tracker status.

The recommended `features-and-large-fixes` preset SHALL resolve all features
to `required`, fast fixes to `optional`, quick and Complex fixes to `required`,
and all chores to `optional`.

#### Scenario: A small bug starts under the recommended preset

- **WHEN** a fix request routes to Fast
- **THEN** its ticket requirement is `optional`
- **AND** the local workflow may proceed without a ticket

#### Scenario: A large bug starts under the recommended preset

- **WHEN** a fix request routes to Quick or Complex
- **THEN** its ticket requirement is `required`
- **AND** synchronization cannot finish unbound

#### Scenario: A custom matrix is incomplete

- **WHEN** one change type, profile, or rule value is absent or unknown
- **THEN** strict policy validation rejects the policy before persistence
- **AND** the last valid tracker configuration remains authoritative

### Requirement: Required and optional work resolve without redundant questions

For `required` work with no binding, synchronization SHALL validate exactly one
target-valid ticket reference from the request when present; otherwise it SHALL
reconcile the exact stable feature marker and create exactly once only when no
unique ticket exists. Multiple references, multiple marker matches, incomplete
lookup, or unknown create outcome MUST fail closed and MUST NOT be guessed or
blindly retried.

For `optional` work with no binding, synchronization SHALL attach one valid
request reference when present. With no reference or pending explicit bind it
SHALL remain local without resolving credentials or making a provider request.
An existing valid binding or explicit bind intent MAY continue to synchronize.
An `off` rule SHALL make no provider request.

#### Scenario: A new feature has no ticket

- **WHEN** a required feature contains no ticket reference and no exact marker
  exists
- **THEN** Empirical durably records create intent and creates one ticket
- **AND** the returned binding proves exactly one linked remote identity

#### Scenario: An optional fix has no ticket

- **WHEN** a Fast fix contains no ticket reference, binding, or pending intent
- **THEN** synchronization returns a local optional status
- **AND** it performs zero authentication and provider operations

### Requirement: Rule-less tracker policies remain compatible

Tracker Policy v1 SHALL retain legacy manual behavior. Tracker Policy v2
without `ticketRules` SHALL retain its existing global `off`, `manual`, or
`ensure` semantics and remain byte-preserved during ordinary load and repair.
A rule matrix refines only whether the active local feature requires a binding;
it MUST NOT enable inbound workflow authority or weaken any existing tracker
target, idempotency, credential, ambiguity, or projection boundary.

#### Scenario: An existing ensure policy has no rules

- **WHEN** the policy is loaded by the rule-capable release
- **THEN** all work retains the existing ensure behavior
- **AND** repair makes no byte change and asks no new policy question
