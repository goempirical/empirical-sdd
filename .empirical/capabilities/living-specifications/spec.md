# Living Specifications Specification

## Purpose

Living capability specifications preserve the current observable product truth while each Complex change declares a reviewable behavioral delta.

## Requirements

### Requirement: Complex changes declare valid capability deltas

Every Complex change MUST include a machine-readable impact manifest before
Specify passes. Behavioral changes MUST name affected capabilities and include
at least one valid delta using ADDED, MODIFIED, or REMOVED requirement sections,
named requirements, and concrete scenarios. Non-behavioral changes MUST include
no capability deltas and MUST instead name affected surfaces and a concrete
regression rationale. Fabricated no-op deltas MUST be rejected.

#### Scenario: Specify validates a behavioral change

- **WHEN** an impact manifest classifies observable behavior as changed
- **THEN** Empirical validates every declared operation against current living specifications
- **AND** it rejects completion when an affected capability lacks a delta

#### Scenario: Specify validates an internal refactor

- **WHEN** the manifest classifies the change as non-behavioral
- **THEN** Empirical requires affected surfaces and a regression rationale
- **AND** it rejects any fabricated capability delta

### Requirement: Reviewed deltas are archived before completion

A behavioral Complex change MUST pass Review, replay and integrate its exact
validated deltas against the current target, and persist a digest-bound
integration receipt before reaching integrated completion. Capability base and
replay digests MUST canonicalize Markdown line endings so LF and CRLF forms of
the same requirement are equivalent while actual text changes remain conflicts.
Projection writes MUST be atomic; any failure restores every touched capability
and preserves the same resumable revision. Non-behavioral changes MUST record an
empty integrated projection with their regression receipt. Doctor MUST validate
each integration receipt against its declared classification: behavioral
receipts require a capability claim and replay fields, while non-behavioral
receipts require a null claim and their independent validation fields. Doctor
MUST report malformed or tampered receipts without mutating them and MUST NOT
apply behavioral-only string operations to a valid null claim.

#### Scenario: Doctor inspects a non-behavioral integration receipt

- **WHEN** an independently verified non-behavioral change stores a valid
  digest-bound receipt whose `claimId` is null
- **THEN** Doctor accepts the receipt without an exception or invalid-receipt finding
- **AND** the receipt and repository remain byte-for-byte unchanged

#### Scenario: Doctor inspects an inconsistent classified receipt

- **WHEN** a receipt is malformed, tampered, or mixes behavioral and
  non-behavioral fields
- **THEN** Doctor reports `INTEGRATION_RECEIPT_INVALID`
- **AND** it does not rewrite or delete the receipt

### Requirement: Capability delta operations are safe and repeatable

Empirical MUST reject unsafe capability names, malformed requirements, duplicate changes, additions of existing requirements, and modifications or removals of missing requirements. Repeating a successful Archive request MUST converge without applying a delta twice.

#### Scenario: Invalid delta is proposed

- **WHEN** a delta cannot be projected unambiguously onto current behavior
- **THEN** Empirical rejects it before changing any living specification

#### Scenario: Successful archive is retried

- **WHEN** an Archive request is repeated after the change reached Done
- **THEN** Empirical reports convergence and leaves capability content unchanged
