# Agent Integrations Specification

## Purpose

Make Empirical workflows discoverable and safely invocable either from one
repository or globally across a developer's projects using each supported
agent's native extension mechanism.

## Requirements

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

### Requirement: Update converges package and integrations

`empirical update` MUST install `empirical-sdd@latest` and invoke the newly
installed CLI as `empirical install --yes`. Update MUST preserve the remembered,
detected, or legacy-managed target set without prompting, MUST NOT expand an
empty set to the entire catalog, MUST report each stage distinctly, and MUST NOT
claim refresh success unless both stages pass.

#### Scenario: A broad prior selection is updated

- **WHEN** npm successfully installs the latest package
- **THEN** the new process reconciles the remembered selected ids and unique roots
- **AND** newly added catalog entries remain unselected until explicitly chosen

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

### Requirement: Agent catalog is deterministic and auditable

The packaged global agent catalog MUST record its upstream repository and pinned
revision or version, use stable ids and aliases, contain only safe home-relative
global roots, and load without telemetry or network access. CI MUST reject
duplicate ids, alias collisions, unsafe roots, non-deterministic order, and
entries with neither a supported global destination nor an explicit exclusion
reason.

#### Scenario: A maintainer refreshes upstream compatibility

- **WHEN** catalog data changes for a release
- **THEN** the reviewed diff records new provenance and target changes
- **AND** runtime installation remains fully local after the package is installed

### Requirement: Safe global uninstall is explicit and ownership-bound

Empirical SHALL provide `empirical uninstall` outside initialized repositories.
It MUST show the complete global removal and project-preservation scope before
interactive mutation, default to cancellation, require `--yes` for
non-interactive or JSON execution, remove only marker-owned current or obsolete
global skills and valid Empirical-owned selection metadata, preserve and report
unsafe or unmanaged targets, and invoke exact shell-free global npm package
removal only after integration cleanup succeeds. Repeated cleanup MUST converge.

#### Scenario: A developer confirms global removal

- **WHEN** the user approves uninstall with managed and unmanaged targets present
- **THEN** all Empirical-managed global skills and owned selection metadata are removed
- **AND** unmanaged files, repository history, and project MCP configuration remain unchanged
- **AND** `npm uninstall -g empirical-sdd` runs last

#### Scenario: Automation omits confirmation

- **WHEN** stdin is non-interactive or structured output is requested without `--yes`
- **THEN** uninstall refuses before changing files or invoking npm

### Requirement: Agent harnesses honor the selected question mode and ticket rule

Generated repository-local workflow guidance SHALL tell every supported agent
to read the effective question mode and resolved ticket requirement from the
Empirical action/status packet. In concise mode an agent MUST avoid restating
expanded menus, context already present in the packet, or an optional no-ticket
decision. It SHALL ask only a material unresolved question and MUST preserve
every explicit approval and safety boundary. Detailed mode SHALL retain the
expanded workflow guidance.

#### Scenario: Optional work has no referenced ticket

- **WHEN** the local skill receives an optional ticket requirement with no
  binding or pending failure
- **THEN** it continues the local workflow without asking whether to create a
  ticket
- **AND** it reports the optional local status concisely

### Requirement: The packaged harness proves no-ticket auto-creation safely

The build and clean-consumer package harness SHALL include an executable demo
that creates an isolated temporary project, supplies an in-memory mock tracker
adapter, starts required feature work with no referenced ticket, and exercises
the production reconcile/create/bind path. The demo MUST make no live provider
request, read no host credential source, and return structured facts proving
one create and one binding.

#### Scenario: A consumer executes the ticket-policy demo

- **WHEN** the packed package runs the demo in a clean temporary consumer
- **THEN** structured output reports a required Complex feature and one bound
  mock ticket
- **AND** the harness fails if authentication, live network access, duplicate
  creation, or a missing binding occurs
