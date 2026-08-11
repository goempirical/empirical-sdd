# Agent Integrations

## Purpose

Reconcile remaining living-contract language with the explicit Init and local
automatic workflow model already implemented for 0.23.

## MODIFIED Requirements

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
