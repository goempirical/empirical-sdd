## REMOVED Requirements

### Requirement: Explore is a pure discovery operation

The MCP, TypeScript, JSON CLI, and explicit non-interview Explore interfaces MUST return consistent guidance, questions, project context, capability context, and concrete Fast or Complex next commands without creating a feature, event, revision, discovery record, or agent runtime.

#### Scenario: Automation investigates vague work

- **WHEN** an agent or script invokes Explore through MCP, TypeScript, `--json`, or `--no-interview`
- **THEN** Empirical returns a deterministic discovery packet and leaves all repository state unchanged

### Requirement: Interactive Explore conducts a Socratic interview

An interactive terminal Explore MUST ask the original five discovery passes one question at a time, add only material follow-ups, show the refined request, and require explicit approval before starting workflow state.

#### Scenario: A developer explores a vague browser-game idea

- **WHEN** the developer runs `empirical explore` in a terminal and answers the interview
- **THEN** Empirical asks domain-relevant questions about the user/problem, observable core loop, MVP boundaries, failure risks, and real browser verification before requesting approval

### Requirement: Agent integrations use the full Socratic contract

Automatic or explicit Socratic discovery MUST conduct the five passes one
question at a time, ask only material follow-ups, reflect answers, present the
complete refined contract, and wait for approval before creating normal-mode
workflow state. The explicit skill MUST draft Specify artifacts and wait for a
second approval. YOLO uses the same durable five-pass record only when a blocker
requires discovery; otherwise it MUST NOT manufacture questions or approvals.

#### Scenario: A YOLO product ambiguity blocks a correct contract

- **WHEN** two incompatible user-visible outcomes remain after repository research
- **THEN** Empirical asks the minimum discriminating question and persists its answer
- **AND** resumes automatically once the blocker is resolved

## MODIFIED Requirements

### Requirement: Explore remains an intentional choice

The single `empirical` skill MUST conduct discovery only for genuinely vague
work or when the user explicitly requests an interview. Concrete requests MUST
route directly through deterministic risk classification. YOLO MUST ask a
question only when multiple materially different product contracts remain and
repository context, policy, prior decisions, and safe defaults cannot select
one correctly.

#### Scenario: YOLO receives a concrete cross-cutting request

- **WHEN** scope, outcome, safety ceiling, and verification are recoverable from the request and repository
- **THEN** routing selects Complex without an interview
- **AND** the workflow advances under its recorded authorization

## ADDED Requirements

### Requirement: Explore is a pure agent operation

The MCP, TypeScript, and private automation Explore interfaces MUST return
consistent guidance, questions, project context, capability context, and
concrete Fast or Complex next operations without creating a feature, event,
revision, discovery record, or agent runtime. Explore MUST NOT be advertised as
a public terminal command.

#### Scenario: Automation investigates vague work

- **WHEN** an agent invokes Explore through MCP, TypeScript, or private automation
- **THEN** Empirical returns a deterministic discovery packet and leaves all repository state unchanged

### Requirement: The single skill conducts the five-pass interview

For genuinely vague work, the single user-facing skill MUST use the internal
Explore and discovery operations to ask the original five discovery passes one
question at a time, add only material follow-ups, show the refined request, and
require explicit approval before starting workflow state.

#### Scenario: A developer explores a vague browser-game idea

- **WHEN** the developer invokes the installed `empirical` skill with a vague browser-game idea and answers the interview
- **THEN** Empirical asks domain-relevant questions about the user/problem, observable core loop, MVP boundaries, failure risks, and real browser verification before requesting approval

### Requirement: Agent integrations use the full discovery contract

Automatic or explicitly requested discovery through the single skill MUST
conduct the five passes one question at a time, ask only material follow-ups,
reflect answers, present the complete refined contract, and wait for approval
before creating normal-mode workflow state. After that approval, the same skill
MUST draft Specify artifacts and wait for the specification approval. YOLO uses
the same durable five-pass record only when a blocker requires discovery;
otherwise it MUST NOT manufacture questions or approvals.

#### Scenario: A YOLO product ambiguity blocks a correct contract

- **WHEN** two incompatible user-visible outcomes remain after repository research
- **THEN** Empirical asks the minimum discriminating question and persists its answer
- **AND** resumes automatically once the blocker is resolved
