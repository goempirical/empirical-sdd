# Workflow Routing

## Purpose

Let the existing deterministic classifier also name which specialist consults a
request implies, without changing any current routing outcome.

## MODIFIED Requirements

### Requirement: Routing is deterministic and inspectable

Every routed request MUST return the selected profile, execution mode, risk
floor, rationale codes, material gates, and the derived specialist consult ids
implied by the request. Equal repository state, policy, and request inputs MUST
produce an equal routing decision, including an equal consult set. The consult
set MUST be derived from the same evaluated signals rather than a parallel
classifier, MUST NOT be influenced by caller-supplied specialist names, and MUST
NOT alter the profile, risk floor, promotion behavior, or gate list that the
same request produced before consults existed.

#### Scenario: Automation routes the same request twice

- **WHEN** the repository, policy, and request are unchanged
- **THEN** both route packets select the same profile and risk floor
- **AND** their rationale codes, required gates, and consult ids are identical

#### Scenario: A request crosses a sensitive boundary

- **WHEN** the request routes to the `sensitive` risk floor or higher
- **THEN** the returned consult set contains `security`
- **AND** the returned profile, mode, risk floor, and gates are unchanged

#### Scenario: A caller names its own specialists

- **WHEN** caller input suggests specialist ids
- **THEN** routing ignores them
- **AND** the derived consult set alone is returned
