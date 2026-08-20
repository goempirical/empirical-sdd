# Project Overview

## Purpose

Empirical SDD is a TypeScript library, Node.js CLI, and stdio MCP server for
agent-neutral, resumable spec-driven repository work. It turns feature requests
into exact Fast or Complex state-machine actions backed by committed contracts,
evidence, review, living capability specifications, and safe Git worktrees.
Source-changing work conditionally enters a persisted Context phase so stale or
placeholder repository knowledge cannot survive a completed workflow.
An optional provider-neutral tracker layer mirrors committed progress to one
GitHub, Linear, or Jira ticket without making remote state authoritative.

## Boundaries

- One active feature is selected per checkout; parallel work uses real linked
  Git worktrees.
- One globally installed, explicit `empirical-init` skill owns first setup and
  repair. Valid initialized repositories carry marker-owned dispatchers and a
  configurable concise/detailed local workflow that automatically routes
  mutation prompts while leaving read-only prompts outside Empirical. New setup
  recommends concise questions while missing legacy fields retain detailed
  behavior. Public CLI commands are Install,
  Update, and ownership-bound Uninstall; workflow operations are MCP/private
  automation APIs.
- Repository knowledge is bounded and file-backed. There are no embeddings,
  hosted indexing services, or persisted private reasoning. Managed placeholder
  topics are reported as refinement-required and withheld from usable context.
- Empirical does not initialize an unconfigured repository implicitly, publish,
  commit user work, force Git, or launch another agent without exact explicit
  approval.
- Tracker Policy v2 may resolve ticket requirements by change type and workflow
  profile. Optional no-reference work stays local without authentication;
  required work retains attach and exactly-once guarded creation.

## Evidence

- Product contract and usage: `README.md`
- Runtime/package boundary: `package.json`, `scripts/build.ts`
- Architecture and security: `docs/architecture.md`, `docs/security.md`
- Core workflow and adapters: `src/core.ts`, `src/cli.ts`, `src/mcp.ts`
