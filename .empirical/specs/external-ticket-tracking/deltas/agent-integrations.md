# Agent Integrations

## Purpose

Expose one coherent Empirical experience per supported agent while retaining a
granular, safety-bounded machine protocol beneath it.

## MODIFIED Requirements

### Requirement: Explicit global skill installation

Empirical SHALL provide an interactive `empirical install` selector outside an
initialized project over the pinned audited agent catalog. It MUST prioritize
detected and managed targets, remember explicit selection, show destinations
and status, accept non-interactive flags, and install exactly the one registered
`empirical` skill at each unique selected destination. Counts and labels MUST
derive from that registry. Installation MUST NOT initialize project state,
require network access, invoke `npx`, or launch an agent.

#### Scenario: A developer installs one selected target

- **WHEN** selection is submitted
- **THEN** exactly one registered Empirical skill is reconciled at its safe destination
- **AND** reports derive the installed count from the same registry

### Requirement: Global integration preserves user configuration

Installation and update MUST reconcile selected ids and their unique normalized
destinations, persist marker-owned selection metadata, and remove a shared root
only when no selected target still depends on it. They MUST remove only
marker-owned obsolete Empirical skills—including Init, Spec, Socratic, Loop,
YOLO, Explore, Fast, and Complex—while preserving unmanaged files,
directories, symbolic links, unrelated configuration, and unsafe targets.

#### Scenario: A managed dedicated skill remains from an older release

- **WHEN** the single-skill installer refreshes its destination
- **THEN** the obsolete marker-owned skill is removed repeatably
- **AND** an unmanaged collision at that path is preserved and reported

### Requirement: Global discovery guidance is agent-accurate

Human and structured installation reports MUST identify selected agent ids,
unique native global skill roots, and created, updated, removed, or preserved
results for the one registered skill. Verified invocation and reload guidance
MAY be shown only from catalog metadata; missing runtime metadata MUST be
labeled unknown and MUST NOT be inferred from skill-file support.

#### Scenario: A skill-only agent is installed

- **WHEN** its runtime invocation metadata is unavailable
- **THEN** the report confirms one installed Empirical skill and destination
- **AND** makes no unsupported launch, prompt, or MCP claim

### Requirement: Native user-invocable workflow entrypoints

The system SHALL expose exactly one global `empirical` skill per selected
agent. It MUST own setup, context, discovery, routing, normal or bounded
autonomy, exact revision execution, evidence, handoff, optional ticket
configuration/synchronization, and terminal reporting. It MUST use granular MCP
operations first and MAY use only the private internal transport as fallback.

#### Scenario: A developer invokes Empirical for a tracked feature

- **WHEN** the current phase advances and a tracker binding exists
- **THEN** the same skill executes the local action and tracker synchronization
- **AND** never asks the developer to invoke another Empirical skill

### Requirement: Honest command discovery report

Root and subcommand help and README MUST present only `empirical install`,
`empirical update`, `empirical uninstall`, and the one native in-agent
`empirical` skill. Each public lifecycle subcommand MUST provide usable help.
Direct state-machine and tracker verbs remain private and MUST be rejected as
human terminal commands.

#### Scenario: A developer asks how to start or resume work

- **WHEN** help or documentation is rendered
- **THEN** it directs the developer to the single installed Empirical skill
- **AND** exposes no Init, Spec, Socratic, Loop, YOLO, or tracker shell command

### Requirement: Explicit skills have disjoint approval boundaries

The one generated skill MUST state its input routing, mutations, approval
boundaries, tracker behavior, stop conditions, and valid recovery behavior.
First-run configuration still requires Apply, Customize, or Cancel; discovery
still requires approval of the refined contract; external handoff, host access,
credentials, delivery, and publication retain their explicit approval gates.

#### Scenario: First use needs both setup and a tracker credential

- **WHEN** the user selects an external provider during setup
- **THEN** configuration stores only safe provider metadata and waits for host credential access
- **AND** cancellation creates neither feature state nor a remote ticket

### Requirement: Installation, MCP, and handoff capabilities are distinct

Empirical MUST model global single-skill installation independently from
project MCP bridges, tracker providers, and executable handoff targets.
Contracting the skill registry MUST NOT remove granular MCP operations or imply
provider credentials, MCP support, or external-launch capability for an agent.

#### Scenario: The registry contracts from six skills to one

- **WHEN** package consistency and MCP smoke checks run
- **THEN** one user-facing skill is installed while all registered MCP operations remain callable
- **AND** no removed skill name is required to reach those operations
