# Agent Integrations Delta

## ADDED Requirements

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
