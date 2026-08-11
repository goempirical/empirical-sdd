# Consolidate Explicit Init Capability Contract

## Request

> Consolidate all seven 0.23 agent-integration requirement replacements into one capability delta so integration from the committed target cannot reintroduce any pre-0.23 global empirical workflow wording, without changing runtime behavior.

## Goal

Produce one self-contained replay delta for every 0.23 replacement of an
existing `agent-integrations` requirement. A clean target at the captured base
must reach the complete explicit Init/local automatic contract in one merge.

## Acceptance Criteria

- [ ] [AC-1] One delta replaces all seven inherited requirement titles affected
  by the 0.23 entrypoint model and contains no partial dependency on an earlier
  uncommitted integration.
- [ ] [AC-2] After independent integration, the living capability contains only
  `empirical-init` as the explicit global skill and local automatic routing as
  the normal mutation workflow, with all approval and safety gates intact.

## Scope

- Consolidate the four original replacements and three follow-up replacements.
- Verify, review, and integrate the result from the committed target base.

## Non-goals

- Runtime, test, package, public documentation, delivery, or publication changes.

## Risks

- Omitting one title can reintroduce stale behavior during replay. The final
  search must cover every old global-workflow phrase.

## Verification

- Full configured CI, review of all seven title-keyed blocks, independent
  integration, and a final stale-phrase search of the living capability.

## Capability Deltas

- `deltas/agent-integrations.md`
