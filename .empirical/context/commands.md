# Commands

## Setup

- `bun install` installs development dependencies.
- `npm install -g empirical-sdd` installs the published runtime CLI.
- `empirical install` installs the single global `empirical` skill per selected
  agent; `empirical update` upgrades it and removes marker-owned legacy skills.
- `empirical uninstall` confirms scope, removes marker-owned global skills and
  selection metadata, then removes the global npm package while preserving
  project history and repository integrations.
- Repository workflows run through the single native `empirical` skill, which
  uses granular MCP/private operations for setup, discovery, routing, tracking,
  continuation, evidence, and integration.

## Run, test, and build

- `bun run check` runs TypeScript without emitting.
- `bun run test` runs the full suite with the integration timeout.
- `bun run test:coverage` runs the suite and enforces module coverage floors.
- `bun run build` generates the Node-compatible `dist/` package.
- `bun run test:dist` builds and exercises the bundled CLI and MCP server.
- `bun run test:package` runs the npm package dry-run.
- `bun run test:consistency` checks version, schema, skill, and operation
  surfaces for drift.
- `bun run ci` executes the complete required pipeline.

## Verification evidence

Command definitions come from `package.json`; CI executes `bun run ci` from
`.github/workflows/ci.yml`. Distribution smoke coverage lives in
`scripts/smoke-mcp.ts` and package inspection in `scripts/test-package.ts`.
