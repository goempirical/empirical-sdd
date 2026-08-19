# Secure Tracker Authentication Review

Status: Pass

Reviewed revision: 12

Test receipt: `executed-ce37576d7b789494cfd32baa`

## Scope

Reviewed the complete source, test, documentation, package, and workflow diff
against AC-1 through AC-10 and accepted decisions D-001 through D-005. The
review emphasized credential provenance, MCP capability negotiation, provider
header/origin semantics, host-file containment and metadata checks, policy
compatibility, diagnostic redaction, generated guidance, and release contents.

## Resolved findings

1. Blocking: Linear OAuth was initially sent as a raw `Authorization` value.
   The final implementation now sends OAuth access tokens as Bearer credentials
   while preserving the raw header required by existing personal API-key
   fallback. This matches Linear's official OAuth and GraphQL authentication
   documentation and is covered by provider and MCP tests.
2. High: MCP initially called the host `authorize()` hook before confirming
   explicit URL-mode capability. The final implementation checks negotiated
   `elicitation.url` first. Form-only, legacy-empty, and absent clients now make
   zero authorization-hook and zero elicitation calls before host fallback.
3. Medium: Human discovery output could replace a custom fallback variable
   name with the provider default. The CLI now renders guidance from the exact
   parsed input, while new setup still recommends `LINEAR_SECRET_KEY`.
4. Medium: Project-level callers could supply a different repository boundary.
   Known project operations now always impose the actual project root before
   reading a fallback file. POSIX ownership, universal link count, canonical
   containment, size, syntax, completeness, and opened-file identity checks are
   enforced.
5. Defense in depth: OAuth validation now contains hostile property access,
   rejects pre-prefixed or whitespace-bearing token values, and detects common
   secret query-field spelling variants. Secret-like tracker bind content is
   rejected before persistence or provider access.

No unresolved findings remain.

## Acceptance review

- AC-1: Pass. Typed resolver credentials are provider-specific and ephemeral;
  GitHub, Linear, and Jira request construction uses the correct authentication
  scheme without policy serialization.
- AC-2: Pass. URL capability is checked before authorization; every emitted
  request is URL mode with no form schema or credential value.
- AC-3: Pass. New defaults are exactly `LINEAR_SECRET_KEY`, `GITHUB_TOKEN`, and
  the atomic Jira pair `JIRA_EMAIL` plus `JIRA_API_TOKEN`.
- AC-4: Pass. All user-facing fallback paths include `Never paste credentials
  into chat`; no instruction asks for or embeds a credential value in a command.
- AC-5: Pass. Resolution order is OAuth, complete environment source, complete
  guarded file source. File reads are bounded, non-mutating, identity-checked,
  owner-restricted on POSIX, and outside the actual repository.
- AC-6: Pass. Missing or partial authentication fails before transport with
  stable value-free guidance; form-only clients fail closed to host fallback.
- AC-7: Pass. Tracker Policy v1/v2 shapes and stored custom names remain
  unchanged; `LINEAR_SECRET_KEY` affects new defaults only.
- AC-8: Pass. CLI, MCP descriptions, generated activation instructions,
  Doctor, README, protocol, MCP, security, architecture, and setup summaries
  use the same OAuth-first and no-chat contract.
- AC-9: Pass. Regression coverage includes all providers, Linear's distinct
  OAuth/API-key headers, capability shapes and actions, resolver failures,
  precedence, Jira atomicity, file attacks, repository overrides, custom names,
  and sentinel non-disclosure.
- AC-10: Pass for source/release readiness. The immutable CI receipt records
  253 passing tests, zero failures, 90.08% aggregate line coverage, passing
  bundled smoke, clean package consumption, aligned `0.25.0` metadata, and diff
  hygiene. Protected delivery and immutable publication remain the subsequent
  workflow operations that establish the external completion facts.

## Release artifact review

The package exports the resolver and authentication types, includes README,
changelog, MCP/protocol/security/versioning documentation, builds the CLI and
MCP entrypoints, and passes installation in a clean consumer. The working-tree
secret scan found only deliberate fake sentinels in regression tests; no user
credential or credential-bearing configuration is part of the source or
evidence scope.
