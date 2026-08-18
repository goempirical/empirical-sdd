# Package Distribution

## Purpose

Keep the SDD-23 public package release internally consistent and make an
operator-requested rollout to managed hosts exact, observable, and fail-closed.

## MODIFIED Requirements

### Requirement: Published release integrity

The repository MUST prepare the additive tracker-onboarding and lifecycle
synchronization change as version `0.24.0` while retaining Schema 5. Package
metadata, runtime constants, help output, tests, generated context, packed-
consumer assertions, and release documentation MUST agree before protected
delivery or publication can begin.

#### Scenario: The 0.24.0 candidate is prepared locally

- **WHEN** all local verification gates complete
- **THEN** every canonical version surface reports `0.24.0`
- **AND** no tag, GitHub release, npm publication, or dist-tag change is inferred

## ADDED Requirements

### Requirement: Managed-host release rollout is explicit and serial

When an operator requests deployment of an exact published release to managed
hosts, Empirical release operations MUST derive targets only from explicit
deployment inventory or operator-confirmed host identities, observe the current
installation before mutation, update one host at a time using its recognized
existing package context, refresh managed integrations, and verify the exact
version plus a basic CLI smoke before continuing. Discovery and receipts MUST
remain credential-redacted. Unknown targets, install methods, or privilege
requirements MUST NOT be guessed. The rollout MUST stop on the first attempted
host failure and MUST report that host and every remaining unattempted target.

#### Scenario: Every inventoried VPS updates successfully

- **WHEN** the exact public package passes a clean-consumer smoke and each host
  preflight identifies a supported existing installation
- **THEN** hosts are updated and verified one at a time in inventory order
- **AND** the rollout report records each bounded host label and before/after version

#### Scenario: One VPS fails its post-update smoke

- **WHEN** a host cannot report the exact authorized version after its update
- **THEN** the rollout records the failure and stops on that host
- **AND** no later host in the inventory is mutated

#### Scenario: Discovery finds only an unlabelled network identity

- **WHEN** an address appears only as a known-host key, database endpoint, or
  inferred cloud address without explicit VPS ownership and deployment intent
- **THEN** it is reported as unresolved rather than selected
- **AND** no network mutation is attempted against it
