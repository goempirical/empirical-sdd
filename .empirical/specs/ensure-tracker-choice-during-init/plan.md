# Ensure Tracker Choice During Init Plan

1. Add a strict tracker setup-state reader in `src/tracking.ts` that
   distinguishes missing, disabled, and provider-policy records. Make explicit
   disable atomically persist the provider-free record while policy application
   atomically replaces it. Retain `TrackerPolicy | null` behavior for workflow,
   status, synchronization, and Doctor callers.
2. Extend `src/setup.ts` summary rendering to display an unresolved mandatory
   Track all/No tracking choice, an explicit disabled current/effective state,
   or the existing provider policy without exposing credential values.
3. Refactor interactive Init in `src/cli.ts` so Apply/Keep and Customize cannot
   bypass an unconfigured tracker decision. Make Track all enter guided provider
   setup with Policy v2 `ticket: ensure`; make No tracking return the disabled
   change; render the complete effective summary and Save/Cancel before mutation.
   Preserve configured and disabled records by default during repair and keep
   explicit non-interactive tracker input compatible.
4. Strengthen the managed `empirical-init` body in `src/integrations.ts` to
   inspect the setup record, recommend Track all work, allow No tracking, require
   the answer before Apply/Save, and forbid ticket binding or creation during
   setup.
5. Add focused regressions in `tests/setup.test.ts`, `tests/cli-config.test.ts`,
   `tests/integrations.test.ts`, `tests/tracking.test.ts`, and `tests/mcp.test.ts`
   for all three states, interactive gating, byte preservation, no-network
   disabled behavior, generated guidance, and strict explicit setup changes.
6. Update the living capability projection, changelog, canonical product and
   package version surfaces for 0.24.1 without changing Schema 5. Run focused
   tests, `bun run ci`, `git diff --check`, and inspect `npm pack --dry-run`.
7. Record immutable test and independent review receipts, integrate the reviewed
   external-ticket-tracking delta against an independent target, then deliver
   source and evidence through protected GitHub PRs to `main`.
8. After the delivered 0.24.1 commit is exact and green, perform the separately
   authorized immutable publication, verify the GitHub release, npm version,
   `latest` dist-tag, and release workflow, and leave the fps-game demo without
   `.empirical` for a clean user retry.
