# Tracker Authentication

## Purpose

Make Linear, GitHub, and Jira authentication OAuth-first while ensuring that a
fallback credential can be supplied only through a trusted host boundary and
never through an agent conversation.

## ADDED Requirements

### Requirement: Tracker authentication is OAuth-first and host-resolved

Empirical SHALL attempt host-managed OAuth authentication before fallback
credentials for Linear, GitHub, and Jira. The host integration MUST expose only
an opaque runtime resolver to Empirical; access tokens, refresh tokens,
authorization codes, client secrets, and fallback credential values MUST NOT
cross CLI or MCP inputs/results, agent context, chat transcripts, repository
state, logs, shell history, or process arguments. OAuth connection URLs MUST
use HTTPS except for a loopback development callback, contain no credential
material, and be opened from MCP only through negotiated URL-mode elicitation.
Form-mode elicitation MUST NOT be used for authentication.

#### Scenario: A URL-capable MCP host offers Linear OAuth

- **WHEN** tracker setup selects Linear, the host resolver advertises an OAuth
  handoff, and the connected client declares URL-mode elicitation
- **THEN** Empirical asks the client to open the trusted OAuth URL out of band
- **AND** discovery begins only after the host resolver supplies credentials
  opaquely inside the server process

#### Scenario: The client supports forms but not URLs

- **WHEN** an OAuth handoff is available but the MCP client declares only
  form-mode elicitation
- **THEN** Empirical does not create an elicitation containing credential
  fields
- **AND** it returns the secret-free host fallback instructions

#### Scenario: OAuth returns sensitive material

- **WHEN** a host OAuth resolver obtains an access or refresh token
- **THEN** the token is used only in memory for bounded provider requests
- **AND** no protocol result, diagnostic, persisted policy, or durable receipt
  contains the token

### Requirement: Fallback credentials use a guarded host-only secret source

When OAuth is unavailable or declined, Empirical SHALL identify fallback
credentials by environment-variable name. New setup SHALL default to
`LINEAR_SECRET_KEY` for Linear, `GITHUB_TOKEN` for GitHub, and `JIRA_EMAIL` plus
`JIRA_API_TOKEN` for Jira. It SHALL display the exact host secrets file as
`${XDG_CONFIG_HOME:-$HOME/.config}/empirical/secrets.env` on POSIX or
`%APPDATA%\Empirical\secrets.env` on Windows and state `Never paste credentials
into chat`. Credential resolution SHALL check injected environment values
before that file, read only the requested names, and keep values in memory.
The file MUST be bounded, regular, non-symlinked, outside the repository, and
owner-only on POSIX; malformed, duplicate, or unsafe files MUST fail closed.

#### Scenario: Linear falls back without OAuth

- **WHEN** no host OAuth resolver can authorize Linear
- **THEN** setup names `LINEAR_SECRET_KEY` and the exact platform host path
- **AND** it tells the user to edit that host file outside chat without showing
  a command that embeds the credential

#### Scenario: A safe host file supplies the credential

- **WHEN** the named environment value is absent and an owner-only host secrets
  file contains one valid assignment for the requested name
- **THEN** Empirical uses the value for the provider request
- **AND** neither `process.env` nor any project or workflow file is modified

#### Scenario: The host file is unsafe

- **WHEN** the secrets path is a symbolic link, is inside the repository, has
  unsafe POSIX permissions, exceeds the size limit, or contains malformed or
  duplicate assignments
- **THEN** Empirical performs no provider request
- **AND** the returned error identifies only the path and corrective action,
  never file contents or credential values

## ADDED Requirements

### Requirement: OAuth-first authentication governs tracker setup

Initialization and repair SHALL inspect the durable tracker setup state before
mutation. When no decision exists, the Tracker section MUST show Track all work
as recommended and No tracking as an explicit alternative, and Apply/Keep or
Customize MUST NOT bypass that choice. Track all SHALL use the selected Linear,
GitHub Projects, or Jira adapter to authenticate through OAuth first or the
guarded host fallback, discover and validate accessible target metadata,
preview all seven semantic phase mappings, and apply Tracker Policy v2 with
ticket behavior `ensure`. No tracking SHALL persist a strict provider-free
disabled record. Configuration MUST reference credential environment-variable
names only and persist neither credential values nor provider responses
containing authorization material. Repair MUST preserve an existing policy or
disabled record byte-for-byte without provider access unless the caller
explicitly changes it.

#### Scenario: New Linear setup uses the safer default

- **WHEN** a user configures Linear without an existing policy
- **THEN** OAuth is offered first and fallback defaults to
  `LINEAR_SECRET_KEY`
- **AND** setup shows the exact host path and the instruction never to paste
  the key into chat before any provider request

#### Scenario: Repair preserves an older Linear policy

- **WHEN** repair loads a valid v1 or v2 policy naming `LINEAR_API_KEY` or a
  custom credential environment variable
- **THEN** the existing policy remains readable and byte-identical by default
- **AND** the name changes only through an explicit previewed reconfiguration

#### Scenario: No credential source is usable

- **WHEN** OAuth cannot resolve a credential and the configured fallback names
  are absent from both the injected environment and the safe host file
- **THEN** discovery fails before provider access
- **AND** recovery output contains the names, exact host path, and
  `Never paste credentials into chat`, but no credential-shaped input field
