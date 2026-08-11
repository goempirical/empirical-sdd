# Package Distribution

## Purpose

Track user-visible package evolution with one canonical version and a durable,
human-readable release history.

## MODIFIED Requirements

### Requirement: Published release integrity

The repository MUST prepare the automatic repository activation change as
version `0.23.0` while retaining Schema 5. Package metadata, runtime constants,
help output, tests, generated context, packed-consumer assertions, and release
documentation MUST agree before protected delivery or publication can begin.

#### Scenario: The 0.23.0 candidate is prepared locally

- **WHEN** all local verification gates complete
- **THEN** every canonical version surface reports `0.23.0`
- **AND** no tag, GitHub release, npm publication, or dist-tag change is inferred

### Requirement: Clean registry consumption

The packed package MUST include the root `CHANGELOG.md` and supported versioning
documentation in addition to its runtime, README, and license, so a clean
consumer can inspect compatibility and release policy without source access.

#### Scenario: A consumer inspects the packed candidate

- **WHEN** the `0.23.0` tarball contents are listed
- **THEN** `CHANGELOG.md` and `docs/versioning.md` are present
- **AND** no internal source module is exposed

## ADDED Requirements

### Requirement: Releases maintain a structured changelog

The repository SHALL maintain a root `CHANGELOG.md` following Keep a Changelog
1.1.0 with an Unreleased section, dated version headings, Added, Changed,
Deprecated, Removed, Fixed, or Security categories as applicable, and compare
links grounded in repository tags. Every release preparation MUST move relevant
Unreleased entries into the exact candidate version without using a raw commit
log as user-facing release notes.

#### Scenario: A user-visible change is prepared

- **WHEN** the package version advances
- **THEN** the changelog describes the observable compatibility impact
- **AND** the new version heading and compare links match package metadata

### Requirement: Alpha releases follow explicit Semantic Versioning

Empirical SHALL follow Semantic Versioning 2.0.0 while `0.y.z`: PATCH is for
backward-compatible fixes, MINOR may introduce additive or breaking public
workflow changes and MUST call out breaking behavior, and MAJOR `1.0.0` is
reserved for the first declared stable compatibility contract. The version in
`src/protocol.ts` is canonical and consistency checks MUST require matching
package metadata, changelog, help, and clean-consumer output.

#### Scenario: An alpha workflow entrypoint changes incompatibly

- **WHEN** a global skill is replaced and repository activation semantics change
- **THEN** the next alpha minor is selected
- **AND** migration instructions appear in the changelog before release

### Requirement: Version preparation is not publication

Version changes, changelog entries, local builds, and packed-consumer tests MUST
remain preparation only. Publication continues to require the existing exact
commit, tag, release, registry, and dist-tag authorization and convergence
checks.

#### Scenario: CI verifies a prepared version

- **WHEN** every local and package gate passes
- **THEN** status may report a verified release candidate
- **AND** it MUST NOT report delivered or published without remote evidence
