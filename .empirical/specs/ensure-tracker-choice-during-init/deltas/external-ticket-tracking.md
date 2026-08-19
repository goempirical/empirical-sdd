# External Ticket Tracking

## Purpose

Ensure every repository makes an explicit tracker decision during Init while
keeping external tracking optional, secret-free, and subordinate to local state.

## MODIFIED Requirements

### Requirement: Tracking is optional and one-way

Empirical SHALL recommend `ensure` tracking for all feature work during first
setup, but MUST require the user to choose between Track all work and No
tracking before initialization mutates the repository. No tracking remains a
fully supported provider-free mode and MUST perform no provider request.
Tracker Policy v2 SHALL choose ticket behavior `off`, `manual`, or `ensure` and
progress visibility `blockers-final`, `milestones`, or `revisions`. Policy v1
MUST remain readable with its existing explicit/manual binding and legacy
projection behavior. Remote data is projection input only for validating a
referenced identity or reconciling an exact Empirical-owned marker; it MUST NOT
mutate, advance, pause, retry, reroute, or complete local workflow state.

#### Scenario: A new repository chooses the recommendation

- **WHEN** Init finds no prior tracker policy or explicit opt-out
- **THEN** Track all work is presented as the recommended choice
- **AND** saving that choice requires an approved provider policy whose ticket
  behavior is `ensure`

#### Scenario: A new repository declines tracking

- **WHEN** the user explicitly chooses No tracking
- **THEN** Init persists a provider-free disabled setup record
- **AND** no provider discovery, binding, synchronization, or ticket creation
  occurs

#### Scenario: A remote ticket is moved manually

- **WHEN** its status differs from the bound Empirical feature
- **THEN** an eligible outbound projection restores the configured Empirical state
- **AND** no Empirical revision is created from the remote change

#### Scenario: Ticket behavior is off

- **WHEN** tracking is configured with ticket behavior `off`
- **THEN** ordinary feature operations perform no bind or provider request
- **AND** the local journal remains authoritative and tracker health explains
  that projection is disabled

#### Scenario: Tracker Policy v1 is loaded

- **WHEN** an existing repository has a valid v1 policy
- **THEN** its target, mapping, and manual binding behavior remain compatible
- **AND** v2 behavior is not persisted until explicitly previewed and applied

### Requirement: Tracker setup is guided, previewable, and explicit

Initialization and repair SHALL inspect the durable tracker setup state before
mutation. When no decision exists, the Tracker section MUST show Track all work
as recommended and No tracking as an explicit alternative, and Apply/Keep or
Customize MUST NOT bypass that choice. Track all SHALL use the selected Linear,
GitHub Projects, or Jira adapter to discover and validate accessible target
metadata, preview all seven semantic phase mappings, and apply Tracker Policy
v2 with ticket behavior `ensure`. No tracking SHALL persist a strict
provider-free disabled record. Configuration MUST reference credential
environment-variable names only and persist neither credential values nor
provider responses containing authorization material. Repair MUST preserve an
existing policy or disabled record byte-for-byte without provider access unless
the caller explicitly changes it.

#### Scenario: Apply recommended settings reaches tracker onboarding

- **WHEN** a first-run user accepts the recommended Verification, Parallel work,
  and Decisions settings
- **THEN** Init still asks Track all work or No tracking before Save
- **AND** no repository file exists until the complete effective summary is
  approved

#### Scenario: Interactive provider setup tracks all work

- **WHEN** a developer selects a provider, runtime credential source, target,
  reviewed state mapping, and progress visibility from discovered choices
- **THEN** Init validates and previews the exact secret-free policy with ticket
  behavior `ensure`
- **AND** only approved identifiers and credential variable names are persisted

#### Scenario: Repair preserves an explicit opt-out

- **WHEN** an initialized repository contains the valid disabled setup record
- **THEN** No tracking is displayed as current and Preserve is the default
- **AND** repair changes no tracker bytes and makes no provider request

#### Scenario: Repair finds no prior decision

- **WHEN** repository configuration exists but neither a tracker policy nor a
  disabled setup record exists
- **THEN** repair asks the same Track all work or No tracking question as first
  setup
- **AND** it cannot infer local-only from absence

#### Scenario: Setup is cancelled

- **WHEN** the user cancels before the final effective summary is saved
- **THEN** Init writes no configuration, disabled record, provider policy, or
  workflow state
- **AND** no provider request or remote ticket effect occurs after cancellation
