# Conventions

## Code and structure

- TypeScript ESM source lives in `src/`; public types are exported through
  `src/index.ts` and compiled declarations.
- Core behavior is independent from CLI and MCP rendering.
- Persistent writes are atomic, path-contained, and symbolic-link aware.
- Stable `EmpiricalError` codes communicate expected failure modes.

## Testing and delivery

- Tests use Bun fixtures in temporary directories and exercise real Git
  worktrees where isolation behavior matters.
- Changes must pass type checking, the full suite, built distribution smoke,
  npm package inspection, and `git diff --check`.
- Version `0.23.0` remains alpha; `src/protocol.ts` is canonical, changelog and
  package surfaces must agree, and publication is a separate explicit action.

## Repository-specific constraints

- `.empirical/` is the durable contract and evidence source of truth.
- Optional external ticket boards are one-way mirrors. Commit the local journal
  first, persist only credential variable names, bind remote identities to the
  exact configured target, and resume durable pending work without treating
  provider state as workflow authority. Runtime values and provider permissions
  come only from the approved host process.
- Fast is restricted to explicit tiny low-risk non-UI work; substantial or UI
  changes use Complex. Source-changing Fast and Complex work must cross the
  conditional Context gate whenever repository knowledge is invalid.
- Do not persist private chain-of-thought or credentials.
- Global installation owns only the explicit `empirical-init` bootstrap.
  Initialization manages short project dispatchers and local `empirical`
  workflow skills through containment and ownership markers; preserve
  unmatched markers, unmanaged collisions, and unsafe paths.
