## MODIFIED Requirements

### Requirement: Initialization creates compact repository knowledge

First agent-owned initialization through the single `empirical` skill MUST
create the bounded inventory and navigable topic pages through its setup and
context operations. When a nonempty repository still has managed or legacy
placeholder topic pages, reports MUST identify those paths as
refinement-required and MUST NOT expose them as usable knowledge.

#### Scenario: An empty repository gains its first implementation

- **GIVEN** initialization created placeholder topic pages for an empty repository
- **WHEN** implementation adds source files and context is refreshed
- **THEN** the inventory updates and semantic topic pages are reported refinement-required
- **AND** the workflow cannot treat those placeholders as usable repository knowledge
