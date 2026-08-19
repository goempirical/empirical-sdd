# Autonomous Delivery

## MODIFIED Requirements

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
