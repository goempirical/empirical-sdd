# Authenticate Sanitized Git Push

## Request

> Fix the live 0.24.0 release blocker discovered during protected delivery: the built-in sanitized HTTPS git push must authenticate through the host's existing GitHub CLI configuration using an ephemeral narrowly scoped Git credential-helper bridge, without inheriting HOME, reading or persisting tokens, changing persistent Git configuration, weakening exact argv, or affecting non-push commands. Add regression and live-boundary verification, deliver the fix and evidence through protected pull requests to main, and prepare but do not publish 0.24.0 or modify any VPS.

## Goal

Make built-in protected delivery work end to end on a host whose HTTPS GitHub
credential is owned by `gh`, while retaining the sanitized, shell-free runtime
and leaving no secret or persistent credential configuration behind.

## Acceptance Criteria

- [ ] [AC-1] Built-in HTTPS `git push` receives an ephemeral Git configuration
  that clears inherited credential helpers and selects `gh auth git-credential`
  using the same host `GH_CONFIG_DIR` locator as direct `gh` commands.
- [ ] [AC-2] The credential-helper environment is supplied only to exact
  `git push` commands; other Git commands, npm commands, and arbitrary
  executables retain their prior minimal environment, while direct `gh`
  commands receive only `GH_CONFIG_DIR`.
- [ ] [AC-3] The runtime does not inherit `HOME`, read a token into Empirical,
  mutate local/global/system Git configuration, or persist environment values;
  command results and receipts retain only non-secret environment key names.
- [ ] [AC-4] Missing or unusable `gh` authentication remains a truthful push
  failure with no credential-source fallback, prompt, retry loop, or secret
  output, and injected process adapters remain deterministic.
- [ ] [AC-5] A live `git push --dry-run` to the configured HTTPS origin succeeds
  with only the sanitized base environment plus the ephemeral helper bridge and
  creates no remote ref.
- [ ] [AC-6] Focused delivery/runtime regressions and the complete clean release
  CI suite pass, including package 0.24.0 consistency and clean consumption.
- [ ] [AC-7] The fix and its immutable evidence are delivered through protected
  source/evidence pull requests with durable receipts, after which final `main`
  is green and no tag, release, npm 0.24.0, dist-tag change, or VPS mutation has
  occurred.

## Scope

- Ephemeral Git credential-helper configuration for built-in HTTPS pushes.
- Direct and descendant GitHub CLI configuration-location propagation.
- Regression tests, live dry-run authentication proof, release notes, and
  protected delivery evidence.

## Non-goals

- Reading, exporting, logging, or storing GitHub token values.
- Running `gh auth setup-git` or modifying any persistent Git configuration.
- Supporting arbitrary credential discovery, interactive prompts, or unknown
  Git providers.
- Publishing 0.24.0 or installing it on a VPS.

## Verification

- Unit tests inspect exact process environments for direct `gh`, `git push`,
  non-push Git, npm, missing-login, and receipt redaction cases.
- A dry-run push executes with an otherwise empty environment and verifies the
  remote branch remains absent.
- `bun run ci` passes locally and in the independent integration worktree.
- Delivery and final-main GitHub facts are inspected before any exact
  publication approval is requested.

## Capability Deltas

- `autonomous-delivery`: HTTPS pushes may obtain credentials from the already
  authenticated host `gh` store through an ephemeral Git helper configuration
  whose values never enter Empirical state.
