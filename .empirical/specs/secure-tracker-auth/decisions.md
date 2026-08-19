# Secure Tracker Authentication Decisions

## D-001: Put OAuth lifecycle behind a host resolver

Status: Accepted

### Evidence

- Linear, GitHub, and Jira require registered provider applications; Jira and
  most confidential deployments also require server-held client credentials.
- Provider access and refresh tokens must not cross an agent or MCP protocol
  boundary.
- The tracker core already accepts injectable runtime dependencies.

### Options

1. Ship provider client credentials and token storage inside the npm package.
2. Describe OAuth in documentation but keep every runtime operation
   environment-token-only.
3. Add a typed host OAuth resolver and keep registration, callback handling,
   refresh, revocation, and encrypted custody at the trusted host.

### Chosen approach

Choose option 3. Empirical consumes a strictly validated in-memory credential
result and an optional secret-free authorization handoff. The default
standalone host truthfully reports OAuth unavailable and uses the safe fallback.

### Trade-offs and risks

- OAuth requires an embedding host to implement the resolver; the package does
  not claim to be a hosted broker.
- Resolver calls become an additional asynchronous failure boundary, so errors
  are replaced with stable generic diagnostics.
- Linear OAuth credentials require a Bearer header, while existing personal
  API-key fallback retains Linear's raw Authorization value.
- Jira requires a distinct OAuth request context with Cloud ID and Bearer
  authorization.

### Verification

Inject connected, authorization-required, unavailable, malformed, and throwing
resolvers. Assert provider-correct requests, generic failures, OAuth
precedence, and zero serialization of returned credential values.

## D-002: Negotiate only MCP URL-mode elicitation for authorization

Status: Accepted

### Evidence

- MCP 2025-11-25 defines URL mode for sensitive out-of-band interaction.
- The specification prohibits form-mode elicitation for sensitive
  information.
- SDK 1.30 distinguishes explicit `elicitation.url` from form-only and the
  legacy empty elicitation object.

### Options

1. Request API keys in a form and rely on client masking.
2. Return an OAuth URL in ordinary tool output and ask the agent to coordinate
   the flow.
3. Send an OAuth handoff only through negotiated URL-mode elicitation and use
   the host fallback for every other capability shape.

### Chosen approach

Choose option 3. URL support must be explicitly declared. Form-only, empty, and
absent elicitation capabilities never receive a secret schema or a form
request.

### Trade-offs and risks

- Older clients use fallback even if they can display ordinary links.
- Acceptance of a URL handoff does not prove connection; the resolver must
  return a valid credential before discovery can access a provider.

### Verification

Exercise URL, form-only, legacy-empty, and absent client capabilities with a
mock resolver. Count elicitation requests, assert every request uses `mode:
url`, and confirm tool inputs/results contain no credentials.

## D-003: Use a guarded host file as the last fallback source

Status: Accepted

### Evidence

- Environment injection is safe for established hosts but users need an exact
  place to configure a value outside chat.
- Repository `.env` files, shell commands containing values, and process
  arguments violate the requested boundary.
- A deterministic per-user configuration path can be inspected without
  writing or exporting its contents.

### Options

1. Recommend a repository-local ignored `.env`.
2. Tell users to export a value in a shell command.
3. Read a bounded owner-only user configuration file after OAuth and injected
   environment resolution.
4. Add OS-specific keychain dependencies and commands in this release.

### Chosen approach

Choose option 3. Use
`${XDG_CONFIG_HOME:-$HOME/.config}/empirical/secrets.env` on POSIX and
`%APPDATA%\Empirical\secrets.env` on Windows. Refuse links, repository
locations, unsafe POSIX permissions, oversized input, malformed lines,
duplicates, and partial provider credential sets. Never create or mutate the
file.

### Trade-offs and risks

- The file is permission-protected rather than encrypted at rest; OAuth and
  host secret managers remain preferred.
- Windows ACL equivalence is host-dependent, so documentation recommends host
  secret management while the implementation still rejects repository and
  link paths.
- Users must edit the file outside chat and restart/retry the host operation.

### Verification

Cover every file validation branch, precedence, path rendering, no
`process.env` mutation, and no provider call before a complete safe source is
available.

## D-004: Preserve Tracker Policy v1/v2 and change only new defaults

Status: Accepted

### Evidence

- Policies already persist names rather than values and therefore remain
  suitable for both OAuth preference and fallback.
- Existing repositories may name `LINEAR_API_KEY` or arbitrary valid
  environment variables.
- Silent rewrites during repair would violate byte-preservation guarantees.

### Options

1. Introduce Tracker Policy v3 with stored OAuth metadata.
2. Rewrite existing Linear names to `LINEAR_SECRET_KEY`.
3. Keep v1/v2 unchanged, resolve OAuth at runtime, and use
   `LINEAR_SECRET_KEY` only as the new interactive default.

### Chosen approach

Choose option 3. OAuth connection identity and tokens remain outside committed
policy. Existing names continue to resolve; only an explicit reconfiguration
can change one.

### Trade-offs and risks

- Policy alone does not reveal whether a host currently has OAuth connected.
- Runtime status and onboarding guidance must explain the selected source
  without storing connection secrets.

### Verification

Retain all v1/v2 fixtures, add legacy `LINEAR_API_KEY` repair assertions, and
confirm new Linear onboarding alone suggests `LINEAR_SECRET_KEY`.

## D-005: Release the feature as 0.25.0

Status: Accepted

### Evidence

- The change adds a public OAuth resolver contract, MCP capability behavior,
  host secret-file resolution, and provider authentication modes.
- Tracker Policy and Schema 5 remain backward compatible.
- Version 0.24.1 is already immutable and published.

### Options

1. Publish patch 0.24.2.
2. Publish minor 0.25.0.
3. Delay publication until a hosted OAuth broker is part of this repository.

### Chosen approach

Choose option 2. This is meaningful backward-compatible functionality and fits
the project's pre-1.0 minor-release convention. Publication remains gated on
protected PR merge, the complete CI suite, and exact authorization.

### Trade-offs and risks

Consumers embedding MCP may opt into the new resolver contract immediately,
while standalone users receive the new fallback behavior without configuration
changes.

### Verification

Align package, protocol, changelog, versioning documentation, smoke checks, and
tarball contents at 0.25.0; then verify the immutable GitHub release and npm
`latest` point to the merged commit.
