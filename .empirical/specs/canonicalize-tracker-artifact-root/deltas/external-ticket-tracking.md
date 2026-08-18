# External Ticket Tracking

## Purpose

Keep approved evidence projection portable across operating-system and
filesystem aliases while retaining the repository security boundary.

## ADDED Requirements

### Requirement: Canonical checkout aliases preserve evidence eligibility

Empirical MUST compare both an approved artifact and its resolved regular-file
target against the same canonical repository root. A lexical checkout alias,
including an operating-system temporary-directory alias or an explicitly
symlinked repository root, MUST NOT by itself make a repository-contained
artifact ineligible. Direct traversal and symbolic-link targets outside the
canonical repository MUST continue to fail before any provider request.

#### Scenario: A repository root has a lexical alias

- **GIVEN** a receipt-approved regular artifact within the canonical repository
- **WHEN** tracker projection is invoked through a repository-root path that
  canonicalizes to a different absolute path
- **THEN** Empirical evaluates and projects the artifact from the canonical root
- **AND** the lexical alias is not reported as a repository escape

#### Scenario: An artifact link escapes the canonical repository

- **WHEN** a receipt path names a symbolic link or resolves to a target outside
  the canonical repository
- **THEN** Empirical rejects the artifact before provider access
- **AND** no canonical-root alias weakens the existing fail-closed boundary
