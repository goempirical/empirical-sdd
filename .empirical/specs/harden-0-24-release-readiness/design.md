# Harden 0.24 Release Readiness Design

## Overview

The repair is intentionally narrow. Receipt validation gains a class-aware
entrypoint shared by Doctor and future repository inspection. The delivery
runner continues to use `spawn` with exact argv and a minimal environment, but
`gh` commands receive one computed `GH_CONFIG_DIR` locator following GitHub
CLI's documented precedence. Project activation is then reconciled through the
existing ownership-aware Init repair path.

## Integration receipt validation

`coordination.ts` will define the persisted non-behavioral receipt shape beside
the existing behavioral `IntegrationReceipt` and export a repository-receipt
verifier accepting unknown JSON. It dispatches on the explicit
`classification: "non-behavioral"` discriminator; legacy behavioral receipts
remain implicitly behavioral and use the existing validator. The behavioral
validator first checks runtime types so malformed null claims produce a bounded
validation error instead of a JavaScript property exception.

The non-behavioral branch validates feature/repository identity, null claim,
target commit/tree, feature tree, non-empty verification digests, timestamp,
absence of behavioral replay fields, and the canonical whole-object digest.
Doctor calls only this class-aware verifier and remains read-only.

## GitHub CLI authentication locator

`delivery.ts` will compute one GitHub CLI configuration directory using the
same precedence documented by `gh help environment`:

1. nonblank `GH_CONFIG_DIR`;
2. nonblank `XDG_CONFIG_HOME` plus `gh`;
3. Windows `APPDATA`/`AppData` plus `GitHub CLI`;
4. the operating-system home plus `.config/gh`.

Only built-in commands whose executable is `gh` receive
`environment: { GH_CONFIG_DIR: <resolved locator> }`. Git and npm commands keep
the existing environment. `HOME`, token variables, and configuration contents
are never passed or read by Empirical. Runtime results already record only
sorted environment keys, so command receipt digests cannot contain the locator
value. If the directory has no usable login, ordinary `gh` failure remains the
observable outcome.

## Integration repair

After the packaged integration template and tests pass, call the existing
ownership-aware Init repair with tracker preservation and unchanged setup
settings. It may replace only marker-owned local activation bytes. Run the same
repair a second time to prove convergence, then run Doctor to confirm project
integration readiness.

## Verification and delivery

Focused tests exercise both receipt classes, malformed mixed receipts, config
directory precedence, sanitized process invocation, and missing-auth failure.
The full `bun run ci` gate then validates all 232+ tests, coverage, distribution,
packed consumer, and consistency. Independent integration replays the three
capability deltas and reruns CI. Protected source and evidence PRs precede a
separate exact publication authorization for `0.24.0`.

## Failure handling

- Invalid receipts remain untouched and produce an actionable Doctor finding.
- Invalid or absent `gh` authentication stops before any falsely reported merge
  or publication convergence.
- Repair preserves unmanaged integration collisions and tracker policy bytes.
- Publication/VPS mutation remains outside this feature until the final commit
  and immutable package target are explicitly authorized.
