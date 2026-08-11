# Reconcile Explicit Init Capability Contract

## Request

> Reconcile the agent-integrations living capability contract so every requirement consistently describes empirical-init as the only explicit global bootstrap and repository-local automatic workflow as the normal mutation path, without changing runtime behavior.

## Goal

Remove the three stale pre-0.23 requirements from the living agent-integration
contract so it no longer tells maintainers or users that the local automatic
workflow is a global explicit skill. This is a contract-only correction; the
already verified runtime, tests, package, and documentation remain unchanged.

## Acceptance Criteria

- [ ] [AC-1] Help/discovery requirements identify `empirical-init` as the only
  explicit global workflow entrypoint and ordinary initialized-repository
  mutation prompts as the normal continuation path.
- [ ] [AC-2] Approval-boundary requirements assign setup review and repair to
  Init while retaining discovery, tracker, evidence, handoff, delivery, and
  publication gates in the repository-local workflow.
- [ ] [AC-3] Installation-separation requirements distinguish the one global
  Init skill, local automatic activation, MCP bridges, tracker providers, and
  external handoff without changing any runtime artifact.

## Scope

- Modify only the three contradictory requirements in the
  `agent-integrations` living capability through one reviewed delta.
- Record the correction and independently integrate it.

## Non-goals

- Changing source, tests, package metadata, help, generated skills, or public
  documentation.
- Reopening the completed 0.23 implementation, publishing, or delivering.

## Risks

- A partial correction could retain contradictory language. Replace each named
  requirement in full and search the integrated capability for stale claims.

## Verification

- Validate delta structure and capability ownership at Specify.
- Run the configured full CI and collect review evidence.
- Integrate against an independent target and search the resulting living
  capability for old explicit-global-workflow claims.

## Capability Deltas

- `deltas/agent-integrations.md`
