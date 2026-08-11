# Empirical SDD

Agent-neutral, resumable spec-driven development with deterministic routing,
immutable evidence, safe cross-worktree integration, optional external ticket
mirrors, and one agent-native skill. Empirical installs across 73 global agent targets and provides verified
guidance for Codex, Claude Code, Cursor, Gemini CLI, Windsurf, and MCP clients.

> Empirical 0.22 is alpha software and intentionally introduces the breaking
> Schema 5 protocol. One checkout selects at most one active feature; linked Git
> worktrees isolate parallel work.

## Install

| Command | Purpose |
| --- | --- |
| `npm install -g empirical-sdd` | Install the CLI. Node.js 22 or newer is required. |
| `empirical install` | Choose coding agents and install the single `empirical` skill. |
| `empirical update` | Upgrade Empirical and reconcile installed skills. |
| `empirical uninstall` | Remove managed global skills, owned selection metadata, then the global package. |

The installer uses a pinned local catalog. It remembers exact target IDs,
deduplicates shared skill roots, and performs no runtime network fetch or `npx`
execution. Automation can use repeatable `--agent`/`-a`, `--all`, `--yes`, and
`--json` options.

Uninstall is fail-closed: interactive use shows the exact scope and defaults to
cancel, while automation must use `empirical uninstall --yes` (optionally with
`--json`). It removes only marker-owned global artifacts. Project `.empirical`
history, evidence, and repository MCP/agent configuration are always preserved;
unmanaged or unsafe global paths are also preserved and reported.

### Difference from the previous command surface

| Previous 0.21 behavior | Updated behavior |
| --- | --- |
| Public lifecycle exposed Install and Update only. | Public lifecycle also exposes `empirical uninstall`. |
| Removing legacy agent skills required manual per-agent cleanup. | One command scans every unique catalog root and removes only marker-owned skills. |
| Selection metadata had to be found manually. | Valid Empirical-owned metadata is removed; invalid or user-owned metadata is preserved. |
| Package removal was a separate manual npm command. | Confirmed uninstall runs exact `npm uninstall -g empirical-sdd` last. |
| Project preservation was implicit. | Help, confirmation, human output, and JSON explicitly report preserved project state. |

## Skills

These are coding-agent skills, not public shell workflow commands.

| Skill | Purpose |
| --- | --- |
| `empirical <request>` | Initialize, interview when needed, route, optionally mirror, resume, and complete the work. |

Native invocation examples include `$empirical` in Codex, `/empirical` in
Claude Code, and `@empirical` in Windsurf. Reload an agent after installation.

## Trust model

Requests are classified into deterministic risk floors: contract-neutral,
behavioral, sensitive, migration, integration, delivery, or publication. Fast
is available only to contract-neutral work. Every higher floor uses Complex;
wording a risky request as “quick” cannot demote it.

Normal mode asks only when a material product choice or permission is missing.
YOLO persists bounded standing authorization and asks only for genuine blockers
before its authorized ceiling. It never bypasses host permissions or branch
protection, force-writes Git, extracts credentials, deletes real worktrees or
branches, replaces immutable releases, or infers publication.

Fast is contract-neutral and ends at verified. Complex records an impact
manifest and proceeds through Specify, Design, Plan, Implement, conditional
Context refinement, Verify, Review, and independent Integrate. An authorized delivery may continue through two
protected GitHub PRs. Publication is always a separate explicit operation bound
to an exact version, commit, tag, and dist-tag.

Evidence is not a caller-supplied boolean. Empirical either executes a Policy v2
command or collects a content-addressed artifact, then writes an immutable
receipt tied to criteria, source state, and provenance. Completion reports only
the highest proven level: implemented, verified, integrated, delivered, or
published.

## External ticket tracking

External tracking is optional and local-only by default. When enabled through
the `empirical` skill, one selected feature can create or attach one ticket in
Linear, GitHub Issues + Projects v2, or Jira Cloud. Empirical's hash-chained
local journal remains authoritative; the ticket is a one-way projection of the
committed phase, normalized status, revision, completion level, and blocker
summary.

The provider-neutral Tracker Policy v1 lives at `.empirical/tracker.json`.
It selects exactly one provider, names its board/project and normalized status
IDs, and stores only credential environment-variable names. Credential values
are read at request time and are never written to `.empirical/`. Bindings and
durable retry projections live under each feature's `tracker/` directory.

After every local journal commit, the skill asks the granular MCP tracker layer
to converge the remote ticket. A provider outage never rolls back or blocks
local SDD progress. Status and action packets expose `local-only`, `synced`,
`pending`, or `failed` tracker health so the same pending revision can be
retried safely. See [MCP usage](docs/mcp.md#external-ticket-mirror) for the
strict provider schemas and state mapping.

## Repository model

Schema 5 stores strict Policy v2 configuration, Manifest v2 knowledge
fingerprints, impact manifests, receipts, Git-common-dir capability claims, and
hash-chained per-feature journals. Terminal journals compact transactionally to
a verified snapshot boundary. `empirical_doctor` diagnoses schema, journal,
lock, claim, toolchain, policy, tracker configuration, credential presence,
knowledge, evidence, worktree, and delivery
state without mutating the repository.

Schema 4 repositories migrate atomically on the first mutating 0.22 operation.
The migration validates a complete candidate tree before promotion and retains
a recovery receipt. Earlier schemas must first be upgraded to Schema 4 with the
version that created them.

## Development

Development requires Node.js 22+ and Bun. CI covers Node 22, 24, and 26.

| Command | Purpose |
| --- | --- |
| `bun install` | Install dependencies. |
| `bun run check` | Type-check the source. |
| `bun run test` | Run the test suite. |
| `bun run test:coverage` | Enforce aggregate and per-module coverage gates. |
| `bun run test:dist` | Build and smoke-test the packaged CLI and MCP server. |
| `bun run test:package` | Install and import the generated npm package. |
| `bun run ci` | Run every required gate. |

The package exposes only `.`, `./protocol`, `./mcp`, and `./integrations`.

## Documentation

[Protocol](docs/protocol.md) · [Architecture](docs/architecture.md) ·
[MCP](docs/mcp.md) · [Demo](docs/demo.md) · [Security](docs/security.md) ·
[Migration](docs/migration-v1.md)

## License

[MIT](LICENSE)
