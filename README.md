# Empirical SDD

Agent-neutral, resumable spec-driven development for coding agents. Empirical
turns an ordinary change request into a deterministic workflow with durable
state, reviewable evidence, and safe Git integration.

> Empirical 0.23 is alpha software. It requires Node.js 22 or newer.

## Install

```sh
npm install -g empirical-sdd
empirical install
```

Choose the agents you use, reload them, then run `empirical-init` once in each
repository. After initialization, ask for work normally—for example, “fix the
pagination bug.” Empirical activates automatically for change requests while
read-only questions stay outside the workflow.

Codex uses `$empirical-init`, Claude Code uses `/empirical-init`, and Windsurf
uses `@empirical-init`. Existing 0.22 repositories should invoke it once after
upgrading; configuration, history, and evidence are preserved.

Doctor verifies that completed repositories still have every required local
instruction, skill, and MCP bridge. If it reports missing or drifted project
integrations, invoke `empirical-init` explicitly to reconcile Empirical-owned
artifacts; unmanaged or unsafe conflicts are preserved and remain visible.

## What it provides

- Deterministic Fast or Complex routing based on the request's risk.
- Resumable Specify, Design, Plan, Implement, Verify, Review, and Integrate phases.
- Immutable evidence tied to criteria, source state, and provenance.
- Isolated parallel work through linked Git worktrees.
- Optional Linear, GitHub Issues + Projects, or Jira ticket mirrors.
- Explicit, guarded delivery and npm publication boundaries.

Completion is reported only at the highest proven level: implemented,
verified, integrated, delivered, or published.

## CLI

| Command | Purpose |
| --- | --- |
| `empirical install` | Select agents and install or repair Empirical integrations. |
| `empirical update` | Upgrade the package and refresh installed integrations. |
| `empirical uninstall` | Remove Empirical-managed global files and the package. |
| `empirical --help` | Show commands and automation options. |

`empirical uninstall` preserves project `.empirical` history, evidence, and
repository configuration. Automation must confirm removal with `--yes`.

## Safety

Empirical asks when a material product choice or permission is missing. It does
not bypass host permissions or branch protection, extract credentials,
force-write Git history, delete real worktrees, or infer publication. Releases
remain bound to an exact version, commit, tag, and npm dist-tag.

## Documentation

[Protocol](docs/protocol.md) · [Architecture](docs/architecture.md) ·
[MCP and tracking](docs/mcp.md) · [Demo](docs/demo.md) ·
[Security](docs/security.md) · [Migration](docs/migration-v1.md) ·
[Versioning](docs/versioning.md) · [Changelog](CHANGELOG.md)

## Development

Development requires Node.js 22+ and Bun. CI covers Node 22, 24, and 26.

```sh
bun install
bun run ci
```

The package exports `.`, `./protocol`, `./mcp`, and `./integrations`.

## License

[MIT](LICENSE)
