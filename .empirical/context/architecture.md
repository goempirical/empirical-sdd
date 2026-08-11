# Architecture

## Components and ownership

- `src/core.ts`: workflow state machine, phase gates, evidence, packets,
  initialization, orchestration, and handoff.
- `src/storage.ts`: schema, feature state, exact journals, atomic writes, locks,
  and migration.
- `src/specifications.ts` / `src/decisions.ts`: living capability deltas and
  evidence-backed Complex decisions.
- `src/worktrees.ts` / `src/checkouts.ts`: safe Git worktree creation and
  checkout-local active selection.
- `src/knowledge.ts` / `src/knowledge-templates.ts`: bounded repository
  inventory, compact context, and managed/legacy placeholder recognition.
- `src/discovery.ts`: ordered Socratic passes, progressive durable answers, and
  exact approved Complex handoff.
- `src/tracking.ts`: strict optional tracker policy, target-bound feature
  bindings, durable pending operations, normalized projection, and GitHub,
  Linear, and Jira adapters.
- `src/agents.ts` / `src/integrations.ts` / `src/lifecycle.ts`: supported-agent
  detection, the single-skill global catalog, managed legacy removal, updates, and
  ownership-bound global uninstall.
- `src/cli.ts` / `src/mcp.ts`: adapters over the same core API.

## Data and control flow

A user invokes the single `empirical` skill in a host agent. The host initializes
or repairs `.empirical/`, retrieves relevant context, then routes, interviews,
drafts, pauses for approval, or resumes through granular MCP operations. After source-changing implementation, invalid repository
knowledge routes through the persisted Context phase before Verify or Done.
Returned actions and evidence still use one state machine.
Optional external tracking commits that state machine first, then converges one
target-bound ticket from durable feature-local pending work. Target drift fails
before provider access, while same-target mapping changes force reprojection;
provider failure cannot roll back local progress.
Complex Review projects validated deltas into living capability specifications.
Git metadata selects the feature owned by each linked checkout.

## External dependencies

- Node.js 22+ runtime APIs and Git subprocesses invoked without a shell.
- `@modelcontextprotocol/sdk` and Zod for the stdio MCP adapter.
- Bun and TypeScript are development/build dependencies, not runtime
  requirements of the published package.
- GitHub, Linear, and Jira HTTPS APIs are contacted only when optional tracker
  policy and host-injected runtime credential variables with access to the
  configured target are present.
