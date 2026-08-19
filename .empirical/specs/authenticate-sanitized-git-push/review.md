# Authenticate Sanitized Git Push Review

## Result

Pass. The implementation follows D-001 and D-002 with no blocking security,
correctness, compatibility, or release-safety finding.

## Criterion review

- AC-1: `githubAuthenticationEnvironment` recognizes only argv beginning
  exactly with `git`, `push`. It supplies the existing deterministic
  `GH_CONFIG_DIR` locator, disables terminal prompting, resets the
  GitHub-HTTPS helper list, and selects the product-owned constant
  `!gh auth git-credential` through indexed process-only Git config.
- AC-2: Direct `gh` returns only `GH_CONFIG_DIR`. Git inspection/fetch, npm,
  Bun, and arbitrary argv return an empty addition object. The built-in runner
  calls this selector once and otherwise retains exact argv, cwd, timeout,
  output bound, and injected-adapter behavior.
- AC-3: No code reads a token, adds `HOME`, invokes persistent `git config`, or
  constructs a credential-bearing URL. `executeCommandCaptured` persists only
  sorted environment key names. Tests prove returned state omits both the gh
  configuration path and helper command value; the live run proves all three
  persistent Git config scope digests are stable.
- AC-4: `GIT_TERMINAL_PROMPT=0`, the empty helper reset, and the single gh
  helper make missing login a bounded noninteractive Git failure. The injected
  adapter test observes one invocation, exit 128, no HOME/token variables, and
  no fallback action.
- AC-5: The production selector plus `spawnSync(..., shell: false)` completed a
  real HTTPS `git push --dry-run` with exit 0. The unique probe ref was absent
  before and after and no configuration digest changed; immutable receipt
  `collected-f5d7bde70ee62a4eb36c4b69` binds the redacted artifact.
- AC-6: Immutable receipt `executed-a263bb58c7e63d47d304a1a3` records 238 tests
  and 1,948 assertions passing with coverage, typecheck, build, bundled CLI/MCP
  smoke, clean packed consumer, and version 0.24.0 consistency.
- AC-7: The delivery authorization is repository/feature/main-bound with a
  `delivered` ceiling. Tag, GitHub Release, npm 0.24.0, dist-tag, and VPS
  operations remain outside the source and evidence plans. Protected delivery
  and final-main checks remain the next observable operations.

## Additional checks

- `git diff --check` passes and the changelog describes the live blocker fix.
- The helper string is a product constant and receives no user-controlled
  interpolation. The outer runtime still executes with `shell: false`.
- The configuration applies to `credential.https://github.com.helper`, matching
  the policy-owned GitHub HTTPS origin without broadening other providers.
- Existing direct-gh inspection, delivery retry, protected merge, publication,
  and injected-runner tests all remain green.

## Residual risk

Git implements its documented `!` helper form internally. The command is
constant and bounded, but the final proof is to use the freshly built runner for
its own source/evidence delivery and then inspect the command-key-only receipt
and final-main CI before release authorization.
