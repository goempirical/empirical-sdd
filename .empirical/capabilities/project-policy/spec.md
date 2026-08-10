# Project Policy Specification

## Purpose

Committed project policy supplies stable domain context and phase-specific guidance to every supported agent while preserving Empirical's mandatory gates.

## Requirements

### Requirement: Project policy enriches action packets

Empirical MUST load validated Policy v2 from committed
`.empirical/policy.json`. It MAY define project context, per-phase guidance,
preferred external agent, exact verification command vectors and timeouts,
evidence settings, and GitHub delivery target and check policy. Action packets
MUST append relevant guidance and report effective policy provenance after
mandatory instructions.

#### Scenario: A phase has local commands and guidance

- **WHEN** Empirical renders its action
- **THEN** the packet includes mandatory instructions, exact policy commands, and guidance
- **AND** identifies the committed policy digest that supplied them

### Requirement: Policy cannot disable enforcement

Policy MUST NOT grant standing authorization, suppress host prompts, redirect
execution outside the current repository, expose credentials, or replace or
bypass criteria, artifact, revision, receipt, integration, protected-branch,
review, delivery, or publication enforcement. Unsafe paths, command shapes,
providers, timeouts, and branch values MUST fail validation before mutation.

#### Scenario: Local policy points command execution above the repository

- **WHEN** the configured working directory resolves outside the repository root
- **THEN** Policy v2 validation rejects it
- **AND** no command or workflow mutation occurs

### Requirement: Policy v2 migrations are deterministic

Schema migration MUST map existing evidence, isolation, decision, and guidance
settings to Policy v2 without inventing authorization or publication intent.
Unknown or invalid legacy values MUST stop migration with a recoverable report.

#### Scenario: Schema 4 has all strict evidence defaults

- **WHEN** migration creates Policy v2
- **THEN** all four evidence settings remain enabled
- **AND** delivery and publication authorization remain absent

### Requirement: Tracker policy is strict and independently versioned

Empirical SHALL validate an independently versioned, repository-contained
tracker policy that is either local-only or selects exactly one of GitHub,
Linear, and Jira. Enabled policy MUST identify the provider target, documented
credential environment-variable names, and a complete mapping from normalized
Empirical progress states to provider-native identifiers. It MUST reject secret
values, unknown keys, ambiguous targets, unsafe URLs, and incomplete mappings
before mutation.

#### Scenario: An existing Schema-5 repository has no tracker policy

- **WHEN** it is opened by the tracker-capable release
- **THEN** it remains valid and behaves exactly as local-only
- **AND** no workflow migration prompt or provider request occurs

### Requirement: Tracker policy cannot weaken protocol authority

Tracker policy MUST NOT grant standing authorization, supply credentials,
enable inbound workflow mutation, suppress host prompts, or replace criteria,
artifact, revision, receipt, integration, protected-branch, delivery, or
publication enforcement. Provider targets and status mappings affect only the
outbound mirror.

#### Scenario: Configuration attempts to make Jira authoritative

- **WHEN** an unknown inbound or authority field is supplied
- **THEN** strict policy validation rejects the configuration
- **AND** the last valid local workflow and tracker policy remain unchanged
