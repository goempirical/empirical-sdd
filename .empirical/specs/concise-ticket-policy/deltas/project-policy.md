# Project Policy Delta

## ADDED Requirements

### Requirement: Interaction questions are selectable and backward compatible

Empirical SHALL store one project interaction question mode, `concise` or
`detailed`, in Schema-5 configuration. New recommended setup SHALL select
`concise`. A valid existing configuration with no interaction field SHALL
normalize to `detailed` without requiring migration or rewriting its bytes.
CLI configuration, MCP initialization/configuration, and interactive setup
MUST resolve to the same persisted value. Every action packet MUST expose the
effective mode so a terminal renderer or agent harness can apply it without
guessing.

#### Scenario: A new repository accepts recommended setup

- **WHEN** setup applies the recommended configuration
- **THEN** the saved question mode is `concise`
- **AND** the effective review shows that selection before Save

#### Scenario: An existing repository has no interaction field

- **WHEN** the tracker-capable release loads its Schema-5 configuration
- **THEN** the effective question mode is `detailed`
- **AND** an ordinary read or repair does not rewrite the configuration

### Requirement: Concise mode removes redundant presentation only

Concise mode SHALL render compact setup, action, status, and tracker summaries
and SHALL direct an agent to ask only the exact material question returned by
the workflow. It MUST NOT skip an approval, ambiguity, credential, evidence,
integration, delivery, publication, or hard-safety gate. Detailed mode SHALL
retain expanded sections and context for users who select it.

#### Scenario: A required decision is ambiguous in concise mode

- **WHEN** the workflow cannot safely choose between two ticket candidates
- **THEN** it asks one short question identifying the alternatives
- **AND** it performs no remote mutation until the ambiguity is resolved
