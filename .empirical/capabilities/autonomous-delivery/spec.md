# Autonomous Delivery Specification

## Purpose

Deliver verified work through protected GitHub workflows under explicit,
bounded authorization while keeping release publication opt-in.

## Requirements

### Requirement: Standing authorization is bounded and durable

YOLO MUST persist the exact authorized scope, repository identity, requested
delivery ceiling, target branch, and expiry condition before autonomous work.
Policy configuration MAY choose defaults but MUST NOT itself grant authority.

#### Scenario: YOLO is requested without publication

- **WHEN** the user authorizes implementation and GitHub delivery only
- **THEN** standing authorization permits work through delivered
- **AND** any publication transition remains unauthorized

### Requirement: GitHub delivery uses a protected two-pull-request sequence

Authorized delivery MUST create intentional source commits, push without force,
open a source pull request, wait for configured required checks, request a normal
merge, and then submit resulting evidence and living-specification changes in a
follow-up evidence pull request. Exact Git and GitHub CLI argument vectors and
remote identifiers MUST be retained as redacted receipts. The built-in
shell-free runner MUST make the host's existing GitHub CLI configuration
directory available to direct `gh` commands and, for exact HTTPS `git push`
commands only, MUST select `gh auth git-credential` through ephemeral Git
configuration. It MUST NOT copy token values, inherit `HOME`, mutate persistent
Git configuration, broaden unrelated command environments, or persist any
configuration value. An absent or unusable host login MUST remain a truthful
command failure.

#### Scenario: An authenticated host pushes through sanitized HTTPS Git

- **WHEN** delivery reaches an exact `git push` and `gh` owns a usable GitHub
  credential in the selected host configuration directory
- **THEN** Git receives an ephemeral helper selection and `gh` locator for that
  process tree only
- **AND** the push authenticates without Empirical reading or persisting the
  credential or changing Git configuration

#### Scenario: Non-push commands remain isolated

- **WHEN** delivery runs Git inspection, npm, or another executable
- **THEN** no GitHub credential-helper configuration is supplied
- **AND** the prior minimal environment contract remains unchanged

#### Scenario: The host login is unavailable

- **WHEN** the selected `gh` configuration cannot answer Git's credential
  request
- **THEN** the push fails truthfully and non-interactively
- **AND** Empirical does not fall back to `HOME`, token variables, prompts, or
  persistent configuration

### Requirement: Delivery failures remain resumable and truthful

Every remote mutation MUST have an idempotency key or observable convergence
check. A retry MUST reuse or recognize matching commits, branches, pull
requests, checks, and merges rather than duplicate them or report delivery from
local state alone.

#### Scenario: A process stops after opening the source pull request

- **WHEN** YOLO resumes with the same authorization and delivery record
- **THEN** it discovers and reuses the matching pull request
- **AND** continues from its actual remote check state

### Requirement: Publication is exact and explicitly requested

Publication MUST require a separate explicit request naming the immutable
version, final merged commit, and intended dist-tag. A delivery-only
authorization MAY use read-only remote inspection to prepare that exact target
after protected source and evidence merges, but MUST terminate at delivered.
Existing tags, package versions, or releases MUST be verified and reused only
when identical; conflicting immutable artifacts MUST stop the workflow and
MUST NOT be replaced.

#### Scenario: Delivery-only release preparation reaches main

- **WHEN** an integrated release candidate is delivered under a `delivered`
  authorization ceiling
- **THEN** protected source and evidence pull requests may merge and read-only
  inspection may identify the final main commit, version, and dist-tag
- **AND** no tag, GitHub Release, registry publication, dist-tag mutation, or
  managed-host rollout occurs without its own exact authorization

#### Scenario: Ordinary YOLO reaches delivered

- **WHEN** no exact immutable release target was separately approved
- **THEN** the workflow terminates at delivered
- **AND** no tag, GitHub release, registry publish, or dist-tag mutation occurs
