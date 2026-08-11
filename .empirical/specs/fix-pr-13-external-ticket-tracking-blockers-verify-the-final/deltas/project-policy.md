## MODIFIED Requirements

### Requirement: Tracker policy is strict and independently versioned

Empirical SHALL validate an independently versioned, repository-contained
tracker policy that is either local-only or selects exactly one of GitHub,
Linear, and Jira. Enabled policy MUST identify the provider target, documented
credential environment-variable names using the runtime's uppercase identifier
grammar, and a complete mapping from normalized Empirical progress states to
provider-native identifiers. Linear policy MUST include `projectId` as either a
provider id or literal JSON `null`. It MUST reject secret values, unknown keys,
ambiguous targets, unsafe URLs, and incomplete mappings before mutation.

#### Scenario: An existing Schema-5 repository has no tracker policy

- **WHEN** it is opened by the tracker-capable release
- **THEN** it remains valid and behaves exactly as local-only
- **AND** no workflow migration prompt or provider request occurs

#### Scenario: Linear tracking is team-only

- **WHEN** configuration supplies the required `projectId` key as literal JSON `null`
- **THEN** policy validation accepts the team-only target
- **AND** no string placeholder or omitted project key is inferred

### Requirement: Tracker policy cannot weaken protocol authority

Tracker policy MUST NOT grant standing authorization, supply credentials,
enable inbound workflow mutation, suppress host prompts, or replace criteria,
artifact, revision, receipt, integration, protected-branch, delivery, or
publication enforcement. Provider targets and status mappings affect only the
outbound mirror. A provider-target change MUST NOT reinterpret a binding's
remote identity and requires explicit replacement. A same-target mapping change
MUST invalidate an earlier synchronization acknowledgment so the committed
revision is projected through the new mapping.

#### Scenario: Configuration attempts to make Jira authoritative

- **WHEN** an unknown inbound or authority field is supplied
- **THEN** strict policy validation rejects the configuration
- **AND** the last valid local workflow and tracker policy remain unchanged
