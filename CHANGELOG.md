# Changelog

All notable changes to Empirical SDD are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
under the alpha rules in [docs/versioning.md](docs/versioning.md).

## [Unreleased]

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

[Unreleased]: https://github.com/goempirical/empirical-sdd/compare/v0.24.0...HEAD
[0.24.0]: https://github.com/goempirical/empirical-sdd/compare/v0.23.0...v0.24.0
[0.23.0]: https://github.com/goempirical/empirical-sdd/compare/v0.22.0...v0.23.0
[0.22.0]: https://github.com/goempirical/empirical-sdd/compare/v0.20.4...v0.22.0
[0.20.4]: https://github.com/goempirical/empirical-sdd/compare/v0.20.3...v0.20.4
[0.20.3]: https://github.com/goempirical/empirical-sdd/compare/v0.20.2...v0.20.3
[0.20.2]: https://github.com/goempirical/empirical-sdd/releases/tag/v0.20.2
