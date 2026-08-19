# Living Specifications

## MODIFIED Requirements

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
