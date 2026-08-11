# Agent Integrations

## Purpose

Make the 0.23 explicit Init and repository-local automatic workflow contract
self-contained in one replayable capability delta.

## MODIFIED Requirements

### Requirement: Explicit global skill installation

Empirical SHALL install exactly one global skill named `empirical-init` for
each selected agent. Installation and update MUST replace only marker-owned
global `empirical` skills from earlier versions after Init is safely installed,
preserve user-owned artifacts and shared selections, and MUST NOT initialize a
repository or launch an agent.

#### Scenario: A developer updates from 0.22

- **GIVEN** a marker-owned global `empirical` skill and remembered agent selection
- **WHEN** the newly installed process reconciles integrations
- **THEN** the old managed skill is removed and `empirical-init` is installed
- **AND** unmanaged collisions and project histories remain untouched

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

### Requirement: Global discovery guidance is agent-accurate

Installation reports and documentation MUST show only the native Init
invocation for verified runtimes. Init MUST be explicitly non-implicit where a
host supports invocation policy metadata; other hosts MUST receive a narrowly
scoped setup/repair description and no unsupported guarantee.

#### Scenario: Codex receives the bootstrap skill

- **WHEN** Empirical installs the Codex target
- **THEN** the report shows `$empirical-init`
- **AND** Codex metadata disables implicit invocation of the bootstrap

### Requirement: Native user-invocable workflow entrypoints

The system SHALL expose `empirical-init` as the only explicit global workflow
skill. Init MUST only review, initialize, repair, and report repository setup,
context, automatic activation, and MCP bridges; it MUST NOT start, resume, or
complete feature workflow state.

#### Scenario: A developer initializes a new repository

- **WHEN** the developer explicitly invokes `empirical-init` and approves setup
- **THEN** valid `.empirical` state and repository-local activation are created
- **AND** no feature specification or selected workflow is created

### Requirement: Honest command discovery report

Root and subcommand help and README MUST present only `empirical install`,
`empirical update`, `empirical uninstall`, and `empirical-init` as the explicit
native bootstrap skill. They MUST explain that ordinary mutation prompts in a
valid initialized repository route through the local workflow without an
Empirical invocation. Direct state-machine and tracker verbs remain private and
MUST be rejected as human terminal commands.

#### Scenario: A developer asks how to start or resume work

- **WHEN** help or documentation is rendered
- **THEN** setup and repair guidance names the native `empirical-init` skill
- **AND** normal or resumed work is described as an ordinary repository prompt
- **AND** no private workflow or tracker verb is presented as a shell command

### Requirement: Explicit skills have disjoint approval boundaries

The generated global Init contract MUST state its setup-only input, mutations,
approval boundary, stop conditions, and repair behavior. The repository-local
automatic workflow MUST retain discovery approval, conservative Fast/Complex
routing, tracker credential boundaries, exact evidence, external handoff,
delivery, and publication authorization. First-run or repair configuration
still requires Apply/Keep, Customize, or Cancel.

#### Scenario: Setup is followed by optional ticket tracking

- **WHEN** the user explicitly initializes a repository and later requests an external mirror
- **THEN** Init completes setup without starting feature or tracker state
- **AND** the local workflow separately obtains tracker configuration and host credential access
- **AND** cancellation creates neither feature state nor a remote ticket

### Requirement: Installation, MCP, and handoff capabilities are distinct

Empirical MUST model global `empirical-init` installation independently from
repository-local automatic activation, project MCP bridges, tracker providers,
and executable handoff targets. Contracting the global registry to Init MUST
NOT remove the detailed local workflow or granular MCP operations, and MUST NOT
imply provider credentials, MCP support, or external-launch capability for an
agent.

#### Scenario: The global registry contains only Init

- **WHEN** package consistency and MCP smoke checks run
- **THEN** one explicit global bootstrap skill is installed while local automatic activation remains generated during initialization
- **AND** all registered MCP operations remain callable
- **AND** no removed global skill name is required for normal repository work
