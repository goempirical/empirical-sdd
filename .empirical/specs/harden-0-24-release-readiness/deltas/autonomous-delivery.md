# Autonomous Delivery

## MODIFIED Requirements

### Requirement: GitHub delivery uses a protected two-pull-request sequence

Authorized delivery MUST create intentional source commits, push without force,
open a source pull request, wait for configured required checks, request a normal
merge, and then submit resulting evidence and living-specification changes in a
follow-up evidence pull request. Exact Git and GitHub CLI argument vectors and
remote identifiers MUST be retained as redacted receipts. The built-in
shell-free runner MUST make the host's existing GitHub CLI configuration
directory available to `gh` through a non-secret locator without copying token
values, broadening the inherited environment, or persisting the locator value.
An absent or unusable host login MUST remain a truthful command failure.

#### Scenario: An authenticated host runs built-in delivery

- **WHEN** `gh` is already authenticated through the host's standard or
  explicitly configured GitHub CLI directory
- **THEN** built-in delivery commands can use that configuration with exact argv
- **AND** receipts record no credential or configuration path value

#### Scenario: The host has no usable GitHub CLI login

- **WHEN** the sanitized runner invokes `gh` without a valid host login
- **THEN** delivery stops with the bounded command failure
- **AND** Empirical neither discovers credentials nor falls back to an unsafe environment
