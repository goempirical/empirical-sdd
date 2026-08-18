# Package Distribution Specification

## Purpose

Define how an Empirical npm release remains internally consistent and usable by
a clean consumer.

## Requirements

### Requirement: Published release integrity

The repository MUST prepare the additive tracker-onboarding and lifecycle
synchronization change as version `0.24.0` while retaining Schema 5. Package
metadata, runtime constants, help output, tests, generated context, packed-
consumer assertions, and release documentation MUST agree before protected
delivery or publication can begin.

#### Scenario: The 0.24.0 candidate is prepared locally

- **WHEN** all local verification gates complete
- **THEN** every canonical version surface reports `0.24.0`
- **AND** no tag, GitHub release, npm publication, or dist-tag change is inferred

### Requirement: Clean registry consumption

The packed package MUST include the root `CHANGELOG.md` and supported versioning
documentation in addition to its runtime, README, and license, so a clean
consumer can inspect compatibility and release policy without source access.

#### Scenario: A consumer inspects the packed candidate

- **WHEN** the `0.23.0` tarball contents are listed
- **THEN** `CHANGELOG.md` and `docs/versioning.md` are present
- **AND** no internal source module is exposed

### Requirement: Public release surfaces converge

Every completed release MUST expose one immutable semantic version through the
merged default-branch commit, annotated Git tag, GitHub release, npm version,
and intended dist-tag. Retries MUST recognize identical existing artifacts;
conflicting tags, versions, or releases MUST stop without deletion or replacement.

#### Scenario: A retry finds the identical published version

- **WHEN** digests, merged commit, tag, release, package, and dist-tag all match
- **THEN** publication converges without creating replacements
- **AND** status reports published from verified remote state

### Requirement: Package exports are narrow and tested

The package MUST expose only its supported root API and explicit `./protocol`,
`./mcp`, and `./integrations` entrypoints. Internal source and storage modules
MUST be unreachable through package exports, and declaration/runtime shapes MUST
be verified from a clean packed consumer.

#### Scenario: A clean consumer imports supported entrypoints

- **WHEN** the packed package is installed without repository-local files
- **THEN** all four supported entrypoints import and type-check
- **AND** an attempted internal subpath import is rejected by package exports

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

### Requirement: Managed-host release rollout is explicit and serial

When an operator requests deployment of an exact published release to managed
hosts, Empirical release operations MUST derive targets only from explicit
deployment inventory or operator-confirmed host identities, observe the current
installation before mutation, update one host at a time using its recognized
existing package context, refresh managed integrations, and verify the exact
version plus a basic CLI smoke before continuing. Discovery and receipts MUST
remain credential-redacted. Unknown targets, install methods, or privilege
requirements MUST NOT be guessed. The rollout MUST stop on the first attempted
host failure and MUST report that host and every remaining unattempted target.

#### Scenario: Every inventoried VPS updates successfully

- **WHEN** the exact public package passes a clean-consumer smoke and each host
  preflight identifies a supported existing installation
- **THEN** hosts are updated and verified one at a time in inventory order
- **AND** the rollout report records each bounded host label and before/after version

#### Scenario: One VPS fails its post-update smoke

- **WHEN** a host cannot report the exact authorized version after its update
- **THEN** the rollout records the failure and stops on that host
- **AND** no later host in the inventory is mutated

#### Scenario: Discovery finds only an unlabelled network identity

- **WHEN** an address appears only as a known-host key, database endpoint, or
  inferred cloud address without explicit VPS ownership and deployment intent
- **THEN** it is reported as unresolved rather than selected
- **AND** no network mutation is attempted against it
