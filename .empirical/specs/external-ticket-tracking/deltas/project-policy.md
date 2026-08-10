# Project Policy

## Purpose

Keep optional tracker routing and state mapping explicit, reviewable, and
credential-free without weakening mandatory workflow gates.

## ADDED Requirements

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
