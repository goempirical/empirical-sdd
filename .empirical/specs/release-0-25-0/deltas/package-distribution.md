# Package Distribution Delta

## Purpose

Bind `0.25.0` to the Windows-corrected OAuth-first tracker release and require
the final protected merge, supported-platform matrix, and public artifacts to
converge before publication is reported.

## MODIFIED Requirements

### Requirement: Published release integrity

The repository MUST prepare `empirical-sdd` version `0.25.0` while retaining
Schema 5 and the OAuth-first tracker authentication contract. Package metadata,
runtime constants, help output, tests, generated context, packed-consumer
assertions, and release documentation MUST agree. The final source MUST include
the platform-correct POSIX and Windows host-secret paths and MUST pass Node 22,
24, and 26 on Ubuntu plus Node 24 on macOS and Windows. Publication MUST be
bound to the protected evidence merge commit created after those checks, and
the annotated Git tag, GitHub release, npm version, and `latest` dist-tag MUST
converge without replacement.

#### Scenario: The Windows-corrected 0.25.0 candidate is released

- **WHEN** the release-note source and evidence pull requests are merged and the
  complete local and GitHub Actions suites are green
- **THEN** exact publication authorization binds `empirical-sdd@0.25.0`,
  `v0.25.0`, `latest`, and the final evidence merge commit
- **AND** trusted npm publication is observed before Empirical reports the
  release as published

#### Scenario: Any immutable release surface conflicts

- **WHEN** the requested tag, GitHub release, npm version, dist-tag, or commit
  already resolves to a different value
- **THEN** publication stops without deletion, force, replacement, or dist-tag
  reassignment
- **AND** the conflict is reported without exposing credentials
