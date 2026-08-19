# Agent Integrations

## MODIFIED Requirements

### Requirement: Global integration preserves user configuration

Global and project reconciliation MUST distinguish the current global Init
skill, the current repository-local workflow skill, and obsolete global or
local entrypoints. It MUST write, update, or remove only marker-owned artifacts
within validated roots and preserve unmatched markers, unmanaged files,
directories, symbolic links, and unrelated content. Whenever packaged
integration templates change, explicit repository repair MUST reconcile every
marker-owned local copy to those exact current bytes, Doctor MUST report drift
until that repair occurs, and a repeated repair MUST be byte-stable.

#### Scenario: A packaged local workflow contract changes

- **WHEN** a completed repository explicitly runs repair after upgrading
- **THEN** every marker-owned local skill is regenerated from the current package
- **AND** Doctor reports project integrations ready while unmanaged content is preserved

#### Scenario: Repair is repeated after convergence

- **WHEN** the same completed repository runs explicit repair again
- **THEN** no integration bytes change
- **AND** no feature workflow state is created
