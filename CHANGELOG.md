# Changelog

All notable changes to Empirical SDD are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
under the alpha rules in [docs/versioning.md](docs/versioning.md).

## [Unreleased]

## [0.26.1] - 2026-08-21

### Fixed

- Made `empirical update` invoke and verify the CLI installed under npm's actual
  global prefix, then fail with actionable diagnostics when an older Empirical
  installation still shadows it through `PATH`.
- Bounded Linear team discovery pages so the nested project and workflow-state
  connections stay below Linear's GraphQL query-complexity limit.

## [0.26.0] - 2026-08-20

### Added

- Added selectable `concise` or `detailed` interaction questions across project
  configuration, CLI, MCP, action packets, status rendering, and generated
  agent guidance. New recommended setup is concise; existing missing fields
  remain detailed.
- Added strict optional Tracker Policy v2 ticket-rule matrices, including the
  `features+large-fixes` preset and resolved change-type/requirement status.
- Added a packaged provider-independent no-ticket feature demo that proves one
  guarded create, one durable binding, and zero live-network calls.

### Changed

- Optional ticket work with no explicit reference now remains local before
  authentication or provider access and no longer causes a redundant ticket
  question; required work retains attach, marker reconciliation, and
  exactly-once guarded creation.

### Migration

- Existing Schema 5 and Tracker Policy v1/v2 repositories require no state
  migration. Repositories without an explicit question mode retain detailed
  questions until configured otherwise; new setup recommends concise mode.

## [0.25.0] - 2026-08-19

### Added

- Added a trusted-host OAuth resolver contract for Linear, GitHub, and Jira,
  with provider tokens kept ephemeral and outside Tracker Policy, MCP tool
  input/output, chat, logs, and repository state.
- Added explicit MCP URL-mode capability negotiation for out-of-band OAuth;
  form-only, legacy-empty, absent, declined, and cancelled clients fail closed
  to the host fallback without receiving a credential form.
- Added a guarded read-only user secrets file fallback at
  `${XDG_CONFIG_HOME:-$HOME/.config}/empirical/secrets.env` on POSIX or
  `%APPDATA%\Empirical\secrets.env` on Windows, including containment, link,
  size, syntax, completeness, and POSIX permission checks.

### Changed

- Made new Linear setup default to `LINEAR_SECRET_KEY`, while preserving every
  existing Tracker Policy v1/v2 name—including `LINEAR_API_KEY` and custom
  valid names—without migration or repair rewrites.
- Made Jira OAuth use Atlassian's Cloud API base with Bearer authorization while
  retaining tenant-origin Basic authentication for email/API-token fallback.
- Made Linear OAuth use its required Bearer authorization while preserving the
  raw `Authorization` value required by existing personal API-key fallbacks.
- Aligned CLI, MCP, generated `empirical-init` guidance, Doctor, README, and
  protocol/security documentation around OAuth-first setup, the exact host
  fallback path, and the rule: `Never paste credentials into chat`.

### Fixed

- Made tracker secret-file path construction honor explicit POSIX and Windows
  semantics, with platform-correct permission fixtures and recovery-path tests.
- Serialized the process-heavy release test suite so temporary Git worktree
  tests cannot exhaust their timeout and race cleanup under parallel load, and
  removed a redundant non-coverage pass from local CI to match the GitHub gate.

## [0.24.1] - 2026-08-19

### Fixed

- Made first-run Init and repairs with no prior tracker decision require an
  explicit choice between the recommended `Track all work` flow and `No
  tracking` before setup can be saved.
- Persisted `No tracking` as a strict provider-free setup record so later
  repairs preserve the confirmed choice without provider or ticket requests.
- Bounded release-test file parallelism so process-heavy CLI coverage remains
  deterministic on high-core hosts while retaining per-test hang detection.

## [0.24.0] - 2026-08-18

### Added

- Added guided Linear, GitHub Projects, and Jira discovery/preview during Init,
  provider-neutral semantic state suggestions, and strict equivalent MCP and
  non-interactive setup surfaces.
- Added Tracker Policy v2 ticket behavior (`off`, `manual`, `ensure`), progress
  visibility, automatic one-ticket reconciliation, idempotent milestone
  comments, and receipt-approved evidence uploads or commit-pinned links.
- Added a packaged, runnable integration-repair demo that reproduces a
  completed repository with missing activation artifacts and proves the
  before, repair, and verified-after states without touching user data.

### Changed

- Tracker synchronization now commits local state first, preserves user-authored
  Linear descriptions, and resumes transition/comment/artifact effects from a
  durable acknowledgement ledger.
- Existing Tracker Policy v1 repositories remain manual/legacy compatible and
  repair preserves tracker bytes unless explicitly changed or disabled.
- Simplified the README around installation, everyday use, safety, and links to
  the detailed project documentation.

### Fixed

- Made Doctor validate both behavioral and non-behavioral integration receipts
  without falsely treating a valid null capability claim as corruption.
- Made the shell-free GitHub delivery and publication runner reuse the host's
  existing `gh` configuration locator without persisting credentials or secret
  values in policy or runtime receipts.
- Made sanitized HTTPS pushes use the host's authenticated `gh` store through
  an ephemeral, push-only Git helper configuration without inheriting `HOME`,
  exporting tokens, or changing persistent Git configuration.
- Made Doctor report missing, drifted, or unsafe required project integrations
  whenever Schema 5 setup is complete, instead of incorrectly reporting the
  repository as activation-ready.
- Kept Doctor read-only and made its remediation point to explicit
  `empirical-init`; repair recreates missing artifacts and updates
  Empirical-owned content while preserving unmanaged conflicts for manual
  resolution.
- Completed the lower stem of the terminal brand mark so its outline renders as
  a closed cross.

## [0.23.0] - 2026-08-11

Published through GitHub Actions trusted publishing with npm provenance.

### Changed

- Replaced the globally automatic `empirical` skill with the explicit,
  setup-only `empirical-init` bootstrap.
- Made initialized repositories route ordinary change prompts automatically
  through marker-owned local instructions and skills; read-only prompts remain
  outside the workflow.
- Added explicit-only invocation metadata where supported and retained all
  existing workflow, evidence, tracker, integration, and publication gates.

### Added

- Added this changelog and a documented alpha Semantic Versioning and release
  policy.

### Migration

- After upgrading from `0.22.x`, invoke `empirical-init` once in each existing
  repository to install local automatic activation. Repair preserves Schema 5
  configuration, context, feature history, and evidence unless setup values are
  explicitly changed.

## [0.22.0] - 2026-08-03

### Added

- Introduced the Schema 5 protocol, strict Policy v2 evidence, resumable
  journals, capability claims, independent integration, protected delivery,
  explicit publication, and a single consolidated global workflow skill.

## [0.20.4] - 2026-07-31

### Fixed

- Completed the `0.20.4` release and its recorded release evidence.

## [0.20.3] - 2026-07-31

### Fixed

- Made CI and release fixtures portable across supported operating systems,
  including Windows executable-extension casing.

### Changed

- Simplified installation guidance and clarified README commands.

## [0.20.2] - 2026-07-30

### Changed

- Prepared and released package version `0.20.2`.

[Unreleased]: https://github.com/goempirical/empirical-sdd/compare/v0.26.1...HEAD
[0.26.1]: https://github.com/goempirical/empirical-sdd/compare/v0.26.0...v0.26.1
[0.26.0]: https://github.com/goempirical/empirical-sdd/compare/v0.25.0...v0.26.0
[0.25.0]: https://github.com/goempirical/empirical-sdd/compare/v0.24.1...v0.25.0
[0.24.1]: https://github.com/goempirical/empirical-sdd/compare/v0.24.0...v0.24.1
[0.24.0]: https://github.com/goempirical/empirical-sdd/compare/v0.23.0...v0.24.0
[0.23.0]: https://github.com/goempirical/empirical-sdd/compare/v0.22.0...v0.23.0
[0.22.0]: https://github.com/goempirical/empirical-sdd/compare/v0.20.4...v0.22.0
[0.20.4]: https://github.com/goempirical/empirical-sdd/compare/v0.20.3...v0.20.4
[0.20.3]: https://github.com/goempirical/empirical-sdd/compare/v0.20.2...v0.20.3
[0.20.2]: https://github.com/goempirical/empirical-sdd/releases/tag/v0.20.2
