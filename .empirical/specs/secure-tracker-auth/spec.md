# Implement Secure Tracker Authentication For Empirical Make Oauth The Pri

## Request

> Implement secure tracker authentication for Empirical: make OAuth the primary connection flow for Linear, GitHub, and Jira. When OAuth is unavailable, provide a safe provider-specific secret fallback; for Linear default to the environment name LINEAR_SECRET_KEY, show the exact host-side path or secure command where the user should configure it, and explicitly state that credentials must never be pasted into chat. Raw credentials must never enter LLM context, chat transcripts, MCP tool arguments/results, repository files, logs, shell history, or process arguments. Add capability negotiation and a fail-closed fallback for clients without secure elicitation, preserve secret-free Tracker Policy compatibility/migration, update CLI/MCP/setup UX, documentation, tests, changelog, and release metadata. Create/update the GitHub PR, pass CI, integrate it, and prepare the next empirical-sdd release.

## Goal

Make tracker onboarding safe by default in both human-driven CLI sessions and
agent-driven MCP sessions. Empirical attempts a host-managed OAuth connection
for Linear, GitHub, or Jira first; otherwise it gives an exact, out-of-band
host credential location and refuses to collect credentials through chat,
tool arguments, repository state, logs, or command-line arguments.

## Acceptance Criteria

- [ ] [AC-1] Linear, GitHub, and Jira setup each begin with a provider-specific
  OAuth connection when the runtime supplies a trusted OAuth credential
  resolver; provider tokens remain opaque to the CLI/MCP caller and the saved
  Tracker Policy.
- [ ] [AC-2] MCP setup negotiates the connected client's declared elicitation
  capabilities. It may open OAuth only through URL-mode elicitation and MUST
  NOT request a credential through form-mode elicitation, ordinary tool input,
  tool output, or assistant text.
- [ ] [AC-3] When OAuth is unavailable or deliberately declined, setup shows
  the exact host-only fallback variable names and secret-file location before
  discovery. Linear defaults to `LINEAR_SECRET_KEY`; GitHub defaults to
  `GITHUB_TOKEN`; Jira defaults to `JIRA_EMAIL` and `JIRA_API_TOKEN`.
- [ ] [AC-4] Every fallback instruction prominently says `Never paste
  credentials into chat` and directs the user to the host-side secrets file:
  `${XDG_CONFIG_HOME:-$HOME/.config}/empirical/secrets.env` on POSIX or
  `%APPDATA%\Empirical\secrets.env` on Windows. No suggested command contains a
  secret value or causes it to enter shell history or process arguments.
- [ ] [AC-5] Runtime credential resolution prefers a successful OAuth
  resolver, then an injected environment value, then the permission-checked
  host secrets file. The file reader accepts only bounded strict assignments,
  refuses links and unsafe POSIX permissions, and never copies credentials
  into process environment, repository files, diagnostics, or durable state.
- [ ] [AC-6] If the host has neither a usable OAuth path nor all required
  fallback values, tracker discovery and synchronization fail before any
  provider request with stable, secret-free recovery guidance. A client that
  supports only form elicitation fails closed to the out-of-band fallback.
- [ ] [AC-7] Existing secret-free Tracker Policy v1 and v2 files, including
  policies naming `LINEAR_API_KEY` or custom environment variables, remain
  readable and byte-preserved during repair. New Linear setup defaults to
  `LINEAR_SECRET_KEY` without silently rewriting old policies.
- [ ] [AC-8] CLI summaries, MCP operation descriptions/results, generated
  `empirical-init` instructions, README/protocol/security documentation, and
  recovery messages consistently present OAuth first, the exact fallback path
  second, and the prohibition against entering credentials in chat.
- [ ] [AC-9] Regression tests exercise all three providers, OAuth preference,
  capability negotiation, safe-file validation, policy compatibility, missing
  credential recovery, and sentinel-secret non-disclosure across returned
  errors and serialized artifacts.
- [ ] [AC-10] The complete release suite passes, the feature is delivered
  through a protected GitHub pull request, and the next minor npm/GitHub
  release is published with aligned package, protocol, changelog, and smoke
  metadata.

## Scope

- A provider-neutral runtime credential resolver with OAuth-first precedence.
- URL-mode MCP elicitation capability negotiation and fail-closed behavior.
- A bounded host-only secret-file fallback and deterministic platform paths.
- Linear, GitHub, and Jira onboarding defaults, CLI/MCP/setup UX, generated
  integration guidance, diagnostics, and documentation.
- Tracker Policy v1/v2 compatibility and regression coverage.
- Release preparation, protected PR delivery, and authorized publication.

## Non-goals

- Implementing or operating a hosted OAuth broker inside the open-source
  package; OAuth lifecycle and encrypted token custody remain a host
  integration responsibility behind the runtime resolver contract.
- Passing provider access or refresh tokens across the CLI/MCP protocol.
- Collecting secrets through MCP form elicitation or an agent-generated form.
- Persisting secrets under a repository, including ignored files.
- Automatically rewriting existing Tracker Policy credential names.
- Weakening local-journal authority, tracker idempotency, provider target
  validation, branch protection, or publication gates.

## Verification

- Run focused tracker, setup, CLI, MCP, integration, doctor, security, and
  migration tests with sentinel credentials and mock OAuth resolvers.
- Exercise URL-capable, form-only, and no-elicitation MCP clients and confirm
  that only URL-capable clients can receive an OAuth handoff.
- Verify safe host secret files resolve credentials while symlinks, oversized
  files, duplicate assignments, malformed lines, and group/world-readable
  POSIX files fail before network access.
- Verify existing Tracker Policy v1/v2 fixtures remain valid and that repair
  preserves their bytes.
- Search generated output, durable artifacts, and test logs for sentinel
  credential values and require zero matches.
- Run `bun run ci`, `git diff --check`, package-content inspection, protected
  PR checks, merge verification, GitHub release publication, and npm `latest`
  verification.

## Capability Deltas

- `deltas/tracker-authentication.md` defines the OAuth-first runtime boundary,
  out-of-band host fallback, and fail-closed setup contract without changing
  Tracker Policy v1/v2.
