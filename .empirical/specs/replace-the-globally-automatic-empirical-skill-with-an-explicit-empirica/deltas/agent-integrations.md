# Agent Integrations

## Purpose

Make initialization the only explicit agent workflow command and make normal
Empirical use automatic only inside initialized repositories.

## MODIFIED Requirements

### Requirement: Explicit global skill installation

Empirical SHALL install exactly one global skill named `empirical-init` for
each selected agent. Installation and update MUST replace only marker-owned
global `empirical` skills from earlier versions, preserve user-owned artifacts
and shared selections, and MUST NOT initialize a repository or launch an agent.

#### Scenario: A developer updates from 0.22

- **GIVEN** a marker-owned global `empirical` skill and remembered agent selection
- **WHEN** the newly installed process reconciles integrations
- **THEN** the old managed skill is removed and `empirical-init` is installed
- **AND** unmanaged collisions and project histories remain untouched

### Requirement: Native user-invocable workflow entrypoints

The system SHALL expose `empirical-init` as the only explicit global workflow
skill. Init MUST only review, initialize, repair, and report repository setup,
context, automatic activation, and MCP bridges; it MUST NOT start, resume, or
complete feature workflow state.

#### Scenario: A developer initializes a new repository

- **WHEN** the developer explicitly invokes `empirical-init` and approves setup
- **THEN** valid `.empirical` state and repository-local activation are created
- **AND** no feature specification or selected workflow is created

### Requirement: Global discovery guidance is agent-accurate

Installation reports and documentation MUST show only the native Init
invocation for verified runtimes. Init MUST be explicitly non-implicit where a
host supports invocation policy metadata; other hosts MUST receive a narrowly
scoped setup/repair description and no unsupported guarantee.

#### Scenario: Codex receives the bootstrap skill

- **WHEN** Empirical installs the Codex target
- **THEN** the report shows `$empirical-init`
- **AND** Codex metadata disables implicit invocation of the bootstrap

### Requirement: Global integration preserves user configuration

Global and project reconciliation MUST distinguish the current global Init
skill, the current repository-local workflow skill, and obsolete global or
local entrypoints. It MUST write, update, or remove only marker-owned artifacts
within validated roots and preserve unmatched markers, unmanaged files,
directories, symbolic links, and unrelated content.

#### Scenario: Project instructions contain user content

- **WHEN** Init adds or refreshes its managed automatic-routing block
- **THEN** the user content remains byte-for-byte outside the managed block
- **AND** repeated repair produces no further filesystem changes

## ADDED Requirements

### Requirement: Initialized repositories activate Empirical automatically

Initialization and repair MUST install a short repository instruction dispatcher
and progressively disclosed workflow skill for the five verified runtimes. The
dispatcher MUST require valid completed `.empirical/config.json`, automatically
route ordinary repository-changing work, skip read-only explanation and
inspection, preserve selected non-terminal work, and delegate the complete
workflow contract to the local skill. Project MCP bridges remain installed.

#### Scenario: A developer asks for an ordinary code change

- **GIVEN** a valid initialized repository with current managed integrations
- **WHEN** the developer asks the agent to fix a bug without naming Empirical
- **THEN** the agent activates the repository-local workflow and routes the work
- **AND** no `/empirical` or `$empirical` ceremony is required

#### Scenario: A developer asks a read-only question

- **GIVEN** the same initialized repository
- **WHEN** the developer asks for an explanation without requesting a change
- **THEN** the agent answers without starting new Empirical feature state

#### Scenario: A repository is not initialized

- **GIVEN** no valid completed `.empirical/config.json`
- **WHEN** an ordinary coding prompt is submitted
- **THEN** repository-local Empirical activation does not enroll the project
- **AND** the developer may explicitly invoke `empirical-init`

### Requirement: Existing repositories have an explicit repair bridge

Documentation and Init behavior MUST provide a one-time repair path for
repositories initialized by versions that removed project-local activation.
Repair MUST preserve stored setup values, feature history, evidence, context
content, and active selection unless the user explicitly changes configuration.

#### Scenario: A 0.22 repository is opened after update

- **WHEN** the developer invokes `empirical-init` once
- **THEN** missing current automatic activation is installed and reported
- **AND** existing workflow history and deliberate repository knowledge remain unchanged
