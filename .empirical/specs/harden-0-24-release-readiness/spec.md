# Harden 0 24 Release Readiness

## Request

> Before publishing empirical-sdd 0.24.0, fix the confirmed release-readiness defects: Doctor must correctly validate non-behavioral integration receipts whose claimId is null; the shell-free GitHub delivery/publication runner must use the host's existing gh CLI authentication configuration without persisting credentials or secret values; regenerate and validate repository-owned Empirical activation integrations; add regression tests; run the full clean release suite and Doctor; then prepare the exact immutable 0.24.0 publication target. Do not publish or modify VPS installations until the exact final commit is verified.

## Goal

Make the already-merged 0.24.0 candidate safe to publish and operate: Doctor
must accept every valid class of integration receipt, GitHub delivery and
publication must work with the host's existing `gh` authentication without
copying credentials into Empirical state, and this repository's generated
activation files must match the packaged contracts.

## Acceptance Criteria

- [ ] [AC-1] Doctor validates a digest-correct non-behavioral integration
  receipt with `claimId: null` without throwing or reporting
  `INTEGRATION_RECEIPT_INVALID`.
- [ ] [AC-2] Doctor continues to reject malformed, tampered, or behaviorally
  inconsistent integration receipts and remains byte-for-byte read-only.
- [ ] [AC-3] The default GitHub delivery and publication runner makes the
  host's existing GitHub CLI configuration location available to `gh` while
  preserving the shell-free exact-argv runtime.
- [ ] [AC-4] No GitHub token, credential bytes, `HOME`, or configuration path
  value is persisted in runtime results, delivery/publication receipts, logs,
  or repository files; only a non-secret environment key may be recorded.
- [ ] [AC-5] Missing or unusable GitHub CLI authentication still fails
  truthfully without credential discovery, while injected test runners retain
  their existing deterministic behavior.
- [ ] [AC-6] Explicit repository repair regenerates the marker-owned Codex and
  Claude Empirical skills so Doctor reports project integrations ready and a
  repeated repair is byte-stable.
- [ ] [AC-7] Focused Doctor, delivery, runtime, and integration regressions plus
  the complete release CI suite pass from the exact candidate tree.
- [ ] [AC-8] The final candidate remains version `0.24.0`; no tag, GitHub
  Release, npm version, dist-tag, or VPS installation is created before exact
  immutable publication authorization.

## Scope

- Class-aware Doctor validation for behavioral and non-behavioral integration
  receipts.
- Safe GitHub CLI configuration-location propagation in the built-in delivery
  and publication runner.
- Regression tests and repository-owned activation repair.
- Clean package/release verification and exact publication preflight.

## Non-goals

- Reading, exporting, logging, or persisting GitHub credential values.
- Weakening the command runtime, publication authorization, protected-branch,
  immutable release, or provider permission boundaries.
- Changing SDD-23 tracker semantics or the public package version.
- Publishing 0.24.0 or changing a VPS before the final commit is reviewed and
  explicitly authorized.

## Verification

- Focused Doctor tests cover valid non-behavioral receipts and invalid receipt
  preservation.
- Focused delivery/runtime tests inspect the exact sanitized process
  environment and confirm no secret values enter receipts.
- Integration repair is run twice and Doctor is healthy after repair.
- `bun run ci` passes in the source checkout and an independent exact-target
  worktree; the packed consumer reports `empirical-sdd 0.24.0`.
- GitHub/npm preflight proves that `v0.24.0` and
  `empirical-sdd@0.24.0` remain absent until publication.

## Capability Deltas

- `living-specifications`: Doctor validates integration receipts according to
  their behavioral classification.
- `autonomous-delivery`: built-in GitHub commands can locate existing host CLI
  authentication without persisting credentials.
- `agent-integrations`: explicit repair reconciles generated local contracts
  after their template changes.
