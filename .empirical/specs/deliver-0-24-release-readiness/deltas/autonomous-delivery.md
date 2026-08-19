# Autonomous Delivery

## MODIFIED Requirements

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
