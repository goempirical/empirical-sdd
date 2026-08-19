# Harden 0.24 Release Readiness Review

## Result

Pass. The implementation follows accepted decisions D-001 through D-003 and
has no blocking correctness, compatibility, security, or release-safety
findings.

## Criterion review

- AC-1: `verifyStoredIntegrationReceipt` dispatches the explicit
  `non-behavioral` class before behavioral claim validation, accepts only a
  null claim, validates all required identities and digests, and verifies the
  canonical whole-object digest. Doctor uses this class-aware boundary.
- AC-2: Behavioral receipts retain their historical absent-classification
  contract and now receive runtime type checks before string operations.
  Non-behavioral receipts reject behavioral replay fields. The Doctor
  regression snapshots repository bytes around valid and mixed receipts.
- AC-3: The built-in shell-free runner adds `GH_CONFIG_DIR` only when argv[0]
  is `gh`; argv, cwd, timeout, output bounds, and process-adapter behavior are
  otherwise unchanged. Locator precedence follows explicit, XDG, Windows
  AppData, and operating-system home sources.
- AC-4: The runner does not inherit `HOME`, `GH_TOKEN`, or `GITHUB_TOKEN`.
  Runtime results retain only environment key names, and the publication
  inspection regression proves the configuration path is absent from returned
  state. No credential value is read or written by Empirical.
- AC-5: An unusable stored login returns the existing truthful inspection
  failure and does not reach npm or attempt another credential source. Injected
  adapters continue to receive deterministic exact invocations.
- AC-6: Ownership-aware `empirical-init` repair regenerated both marker-owned
  skill copies, preserved the tracker configuration byte-for-byte, and a second
  identical repair made no changes. Doctor reports all nine required project
  integrations ready.
- AC-7: Immutable receipt `executed-daf918fa76dc19fe6e178e64` records the exact
  configured `bun run ci` command passing 236 tests and 1,933 assertions,
  coverage gates, typecheck, build, bundled CLI/MCP smoke, packed-consumer, and
  version-consistency checks.
- AC-8: Package and generated metadata remain at `0.24.0`. Inspection confirms
  no `v0.24.0` tag, GitHub Release, npm `0.24.0`, dist-tag change, or VPS
  installation was created during this feature.

## Additional checks

- Current-source Doctor validates 42 immutable receipts and 41 journal chains,
  reports current knowledge and integrations, and has only the expected
  secret-free `LINEAR_API_KEY` availability warning.
- A process with only `PATH` and the computed `GH_CONFIG_DIR` can use the host's
  existing GitHub CLI login, proving the production boundary rather than only
  the injected-adapter test.
- `git diff --check` passes and the changelog describes both release-readiness
  fixes.

## Residual risk

Publication and fleet rollout remain intentionally untested mutations until the
integrated source and evidence pull requests establish the exact immutable main
commit and the user authorizes that target.
