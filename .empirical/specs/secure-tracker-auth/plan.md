# Secure Tracker Authentication Plan

This plan implements the independently owned `tracker-authentication`
capability without modifying the existing external-ticket-tracking contract.

## 1. Establish the runtime authentication boundary

- Add public provider-specific OAuth credential, authorization-handoff,
  resolver, secret-file, and resolved-authentication types in `src/types.ts`.
- Add `src/tracker-auth.ts` for strict OAuth result/handoff validation,
  provider fallback defaults, platform path expansion, user-safe guidance,
  source precedence, safe-file inspection/parsing, and generic resolver error
  containment.
- Export only secret-free guidance and host integration contracts from
  `src/index.ts`; never export or serialize a resolved runtime credential.
- Unit-test default names and paths, resolver precedence, malformed resolver
  output, hermetic injected environments, and every file validation branch in
  `tests/tracker-auth.test.ts`.

## 2. Refactor tracker providers to typed authentication

- Replace internal credential string arrays in `src/tracking.ts` with the
  discriminated resolved-authentication union and asynchronous resolution.
- Thread repository root and tracker dependencies through discovery, preview,
  bind, sync, reconciliation, and retry paths without changing their public
  policy inputs.
- Keep GitHub and Linear fixed endpoints while sourcing their tokens from
  OAuth-first typed auth.
- Consolidate Jira headers and API-base selection so Basic fallback uses the
  configured tenant origin and OAuth uses Bearer plus
  `https://api.atlassian.com/ex/jira/{cloudId}` for every Jira operation.
- Preserve secret redaction for resolver values and replace resolver-originated
  exceptions with stable generic errors.
- Extend `tests/tracking.test.ts` for all three OAuth providers, Jira endpoint
  selection, environment/file fallback, precedence, partial-source rejection,
  no-network failures, and sentinel non-disclosure.

## 3. Add MCP OAuth handoff negotiation

- Let `createMcpServer` and `runMcpServer` accept optional trusted tracker
  dependencies and pass repository root to every tracker operation.
- Before provider access, request a secret-free OAuth handoff from the resolver.
  Invoke `server.server.elicitInput` only when
  `getClientCapabilities().elicitation.url` is explicitly present and only
  with `mode: "url"`.
- Treat decline, cancel, form-only, legacy-empty, absent capability, and an
  accepted-but-unresolved connection as fallback/fail-closed paths; never
  construct a credential form schema.
- Validate authorization URLs and IDs before elicitation and ensure MCP tool
  results/errors expose guidance but no resolver credential.
- Extend `tests/mcp.test.ts` with URL, form-only, empty, and absent-capability
  clients plus connected/declined/unresolved resolver cases.

## 4. Make setup and recovery unambiguous

- Change new Linear onboarding in `src/cli.ts` from `LINEAR_API_KEY` to
  `LINEAR_SECRET_KEY` while retaining arbitrary existing names.
- Before any credential-name prompt, render OAuth first, the expanded host
  secret path, provider fallback names, and `Never paste credentials into
  chat`. Keep prompts limited to variable names.
- Update `src/setup.ts` summaries and `src/cli.ts` missing-credential recovery
  to reuse centralized guidance.
- Strengthen the generated `empirical-init` contract in `src/integrations.ts`:
  use host OAuth when available; otherwise direct the human to the exact host
  path, never request/accept/echo a credential, and resume only after host-side
  configuration.
- Update operation/MCP descriptions as needed so tracker tools state that raw
  credentials are never valid arguments.
- Update setup, CLI, integration, MCP, and Doctor regressions for the exact
  wording and zero provider effects before safe authentication.

## 5. Document compatibility and the security contract

- Update `README.md` with OAuth-first provider behavior, exact fallback paths,
  default names, safe file permissions, and a conspicuous no-chat warning.
- Update `docs/security.md` with resolver, URL-elicitation, file, precedence,
  Jira, and redaction trust boundaries.
- Update `docs/protocol.md` to state that Tracker Policy v1/v2 remains
  secret-free and OAuth selection is runtime-only.
- Update `docs/mcp.md` with capability negotiation and host embedding examples
  that contain no real or placeholder command-line secret.
- Add packaged security documentation if package inspection shows it is not
  currently shipped.

## 6. Prepare release 0.25.0

- Add the 0.25.0 changelog entry and update `package.json`,
  `src/protocol.ts`, `docs/versioning.md`, `scripts/smoke-mcp.ts`, and any
  consistency/package fixtures.
- Build and inspect the tarball to confirm expected documentation and no
  credentials, local state, or unintended files are included.
- Run focused auth/tracker/setup/MCP tests, TypeScript checks, `git diff
  --check`, and the complete `bun run ci` gate.

## 7. Prove, review, integrate, deliver, and publish

- Record configured immutable test and review evidence for every acceptance
  criterion; search output and durable feature files for sentinel secrets.
- Refresh repository knowledge after source changes and clear the Context gate.
- Review the diff for auth-boundary leaks, SSRF, symlink/path, permissions,
  Jira API-base, MCP capability, compatibility, and release risks.
- Integrate the reviewed capability delta against an independent current-main
  worktree through Empirical.
- Commit only the feature source paths and its intended Empirical evidence,
  push a new branch, open the protected GitHub PR, and wait for all required
  checks.
- Merge only after checks pass. With the user's explicit release authority and
  Empirical's exact publication authorization, publish immutable `v0.25.0`,
  then verify the GitHub release, tag commit, npm package integrity, and
  `latest` dist-tag.
