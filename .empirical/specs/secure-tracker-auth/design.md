# Secure Tracker Authentication Design

## Evidence

The existing tracker boundary is already secret-free at rest: Tracker Policy
v1/v2 persists only provider targets, state mappings, behavior, visibility, and
credential environment-variable names. Runtime operations currently resolve
those names directly from `process.env` and pass plain string arrays to the
provider adapters. Interactive Init defaults Linear to `LINEAR_API_KEY`, while
the generated agent contract does not tell a user where to configure a value or
explicitly prohibit pasting it into chat.

The provider protocols are not interchangeable:

- GitHub supports OAuth authorization-code and device flows; its resulting
  bearer token can use the current GitHub API endpoint.
- Linear recommends OAuth 2.0, supports PKCE and refresh tokens, and its bearer
  token can use the current Linear GraphQL endpoint.
- Jira Cloud recommends OAuth 2.0 3LO. OAuth calls require a Bearer token and
  the fixed `https://api.atlassian.com/ex/jira/{cloudId}` base, unlike the
  existing email/API-token Basic authentication against the tenant origin.
- MCP 2025-11-25 distinguishes URL-mode from form-mode elicitation and forbids
  form-mode collection of sensitive information. The installed SDK exposes the
  client's negotiated `elicitation.url` capability and URL-mode
  `elicitation/create`.

An open-source local package cannot provide universal OAuth on its own: each
provider requires a registered application and durable encrypted token
custody. Those deployment assets already belong at a trusted host boundary, not
inside a repository, tool call, or agent transcript.

## Design

This spec independently owns the `tracker-authentication` capability. The
existing `external-ticket-tracking` capability remains unchanged while this
feature strengthens the authentication boundary it consumes.

### Provider-neutral runtime authentication

Replace plain credential arrays with a discriminated in-memory authentication
union:

- GitHub OAuth or fallback: bearer token.
- Linear OAuth or fallback: bearer/API token.
- Jira OAuth: bearer access token plus validated Cloud ID.
- Jira fallback: email plus API token for Basic authentication.

Add a `TrackerOAuthResolver` dependency with two host-owned operations:

1. Return a secret-free authorization handoff descriptor when a connection is
   required.
2. Resolve an already connected provider into the typed in-memory
   authentication union.

Resolver exceptions are converted to stable generic errors before any host
text can reach a caller. Returned structures are strictly validated, kept only
for the operation, included in transport redaction lists, and never serialized.
Credential resolution is atomic by source and ordered as:

1. connected host OAuth;
2. a complete set of injected environment values;
3. a complete set from the guarded host secrets file.

A partial Jira source is an error instead of being combined with another
identity source.

### OAuth handoff and MCP capability negotiation

The OAuth handoff descriptor contains only provider, a bounded opaque
elicitation ID, a short message, and an HTTPS authorization URL with no user
info, fragment, or credential query fields. Loopback HTTP is accepted only for
explicit development dependencies.

The MCP tracker discovery and preview paths ask the resolver whether an OAuth
handoff is needed before resolving fallback credentials:

- if the client explicitly declares `elicitation.url`, send one URL-mode
  elicitation, honor accept/decline/cancel, then resolve authentication again;
- if the client exposes form mode only, an empty legacy elicitation capability,
  or no elicitation capability, never send an elicitation and continue to the
  host fallback;
- never define a secret-valued MCP schema or return resolver credentials in
  structured content.

`createMcpServer` and `runMcpServer` accept optional tracker dependencies so a
trusted host can supply its OAuth resolver. The default standalone server has
no broker and truthfully uses fallback resolution.

### Guarded host secrets file

Add a read-only secret-file resolver. Its deterministic default is:

- POSIX: `${XDG_CONFIG_HOME:-$HOME/.config}/empirical/secrets.env`
- Windows: `%APPDATA%\Empirical\secrets.env`

The concrete expanded path is always shown to a human. An explicitly injected
path is supported for a trusted embedding and hermetic tests. Supplying a test
`env` map disables implicit home-file reads unless a file path is also
explicitly supplied, preventing tests from consuming developer credentials.

Before parsing, the reader:

- uses `lstat` and rejects symbolic links and non-regular files;
- resolves the path and rejects any location inside the repository root;
- limits the file to 64 KiB;
- on POSIX, rejects group/world permission bits and requires an owner-only
  file;
- accepts only blank lines, comments, and strict uppercase `NAME=value`
  assignments;
- rejects malformed or duplicate names and reads only the requested complete
  credential set.

It does not mutate `process.env`, create the file, print values, or offer a
shell command containing a value. Guidance tells the user to edit the expanded
path outside chat and may show a value-free `chmod 600 <path>` command.

### Provider adapter changes

GitHub and Linear adapters continue using their fixed endpoints and authorization
headers, now sourced from typed authentication. Linear OAuth uses a Bearer
header while personal API-key fallback preserves the raw Authorization value.
Jira helpers accept the Jira
authentication union:

- fallback builds the existing Basic header and tenant-origin base URL;
- OAuth builds `Authorization: Bearer …` and the fixed Atlassian Cloud API base
  from the validated Cloud ID.

All Jira discovery, create, attach, reconcile, transition, comment, and upload
paths use the same helpers so no operation silently falls back to Basic or the
wrong host. Existing HTTPS, timeout, response-size, pagination, target, and
redaction protections remain in force.

### Setup and recovery UX

Centralize provider fallback defaults and guidance:

- Linear: `LINEAR_SECRET_KEY`
- GitHub: `GITHUB_TOKEN`
- Jira: `JIRA_EMAIL` and `JIRA_API_TOKEN`

Interactive Init prints OAuth as the preferred path, then the expanded fallback
path and `Never paste credentials into chat` before it asks only for optional
environment-variable *names*. Setup summaries, missing-credential errors,
recovery hints, README, protocol/security documentation, MCP descriptions, and
the generated `empirical-init` contract reuse the same language.

The generated agent contract explicitly instructs the agent to use host OAuth
when available and otherwise pause so the human can edit the host file. It
forbids asking for, accepting, echoing, or forwarding the value and resumes
discovery only after the user confirms host-side configuration.

### Compatibility and release

Tracker Policy schema remains v1/v2. Any valid existing name, including
`LINEAR_API_KEY`, keeps working and repair preserves existing tracker bytes.
Only newly initiated Linear setup changes its suggested name to
`LINEAR_SECRET_KEY`. No automatic credential-name migration occurs.

This is a backward-compatible public runtime extension with meaningful new
behavior and exported types, so it ships as minor version `0.25.0`. Package,
protocol, changelog, versioning documentation, smoke tests, and packaged
security documentation remain aligned.

## Verification

- Unit-test typed OAuth results for all providers and Jira OAuth endpoint/header
  selection.
- Verify OAuth wins over environment and file sources, while decline or absent
  capability uses fallback.
- Drive MCP clients declaring URL, form-only, empty legacy, and no elicitation
  capabilities; assert zero form requests and no secret content.
- Test missing, safe, symlinked, repository-contained, oversized,
  group/world-readable, malformed, duplicate, partial, and hermetic secret-file
  cases before any transport call.
- Retain Tracker Policy v1/v2 parsing and byte-preserving repair tests,
  including `LINEAR_API_KEY`.
- Use sentinel credentials in resolver, environment, file, response, and thrown
  transport errors; search all returned values and durable artifacts for zero
  sentinel disclosure.
- Run focused tests and the complete `bun run ci` gate, inspect the tarball,
  pass protected PR checks, merge, publish `v0.25.0` through the trusted
  workflow, and verify npm `latest` plus the GitHub release commit.

## Risks and mitigations

- A host could claim OAuth while returning unsafe material. Strict descriptor
  and credential schemas plus generic resolver errors contain that boundary.
- Jira OAuth could accidentally use a tenant URL or Basic header. One typed
  Jira request-context helper is required by every Jira path and covered by
  full adapter tests.
- A fallback file could broaden secret exposure. It is outside repositories,
  read-only, bounded, non-symlinked, owner-only on POSIX, never auto-created,
  and lower priority than OAuth/environment injection.
- MCP clients vary in elicitation support. URL support must be explicit; all
  other capability shapes take the tested fail-closed fallback.
- Existing callers use synchronous credential resolution internally. The
  resolver makes it asynchronous; dispatch changes stay internal while public
  async operations and Tracker Policy schemas remain compatible.

## Primary protocol references

- Linear OAuth 2.0 authentication:
  https://linear.app/developers/oauth-2-0-authentication
- GitHub OAuth authorization and device flow:
  https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
- Atlassian OAuth 2.0 3LO authorization-code flow:
  https://developer.atlassian.com/cloud/oauth/getting-started/implementing-oauth-3lo/
- MCP URL-mode elicitation:
  https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation
