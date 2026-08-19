# Security model

Empirical treats requests, repository content, specs, decisions, evidence,
receipts, Git metadata, policies, CLI/MCP inputs, and remote observations as
untrusted.

- Strict schemas reject unknown fields at protocol boundaries. Feature,
  capability, command, branch, and artifact identifiers use portable
  allowlists; repository paths cannot be absolute or traverse upward.
- Atomic writers preserve modes and refuse managed symbolic-link paths.
  Ownership-aware locks cannot remove a newer caller's lock.
- Policy commands run as exact argument arrays without a shell. Output, timeout,
  and working directory are bounded. Shell launchers and control syntax are
  rejected.
- Evidence consists of immutable, canonical-digest receipts. Executed receipts
  retain command/result/source provenance; collected receipts fingerprint
  repository-contained artifacts. Caller assertions are not evidence.
- Capability ownership is shared through the Git common directory. Integration
  verifies base digests, detects claim conflicts, validates in an independent
  worktree, rolls back candidate projections, and never force-writes Git.
- Worktree and agent-handoff proposals are read-only and integrity-bound.
  Creation or host execution requires literal approval of an unchanged exact
  path/branch/argv proposal.
- Manifest v2 inventory is bounded and excludes ignored, build, dependency,
  secret-like, binary, and oversized paths. It stores fingerprints, not a
  remote semantic index. Stale generated pages are not silently retrieved.
- Tracker Policy v1/v2 stores only provider target IDs, normalized status IDs,
  behavior/visibility choices, and credential environment-variable names
  matching `^(?=.{2,64}$)[A-Z][A-Z0-9]*_[A-Z0-9_]+$`. Runtime authentication
  is selected outside policy in strict order: a trusted host OAuth resolver, a
  complete injected environment set, then a permission-checked host secrets
  file. OAuth registration, callbacks, refresh, revocation, and encrypted token
  custody remain host responsibilities. Resolver failures are replaced with
  stable diagnostics, returned credential shapes are strictly validated, and
  ephemeral values are added to transport redaction without serialization.
- An OAuth handoff is a secret-free HTTPS URL, bounded opaque elicitation ID,
  provider, and short message. MCP sends it only when the connected client
  explicitly declares `elicitation.url`. Form-only, legacy-empty, absent, or
  failed elicitation support receives no request and falls back out of band.
  Form schemas, tool arguments/results, assistant text, and chat are never
  credential channels.
- The fallback file is
  `${XDG_CONFIG_HOME:-$HOME/.config}/empirical/secrets.env` on POSIX or
  `%APPDATA%\Empirical\secrets.env` on Windows. Empirical never creates it or
  mutates `process.env`. The reader rejects final symbolic links, non-regular
  files, repository-contained paths (including resolved aliases), files over
  64 KiB, malformed or duplicate assignments, partial provider identities, and
  group/world POSIX permission bits. Explicit test environments do not trigger
  implicit reads of a developer's home file.
- GitHub and Linear OAuth tokens use Bearer authorization at their fixed API
  endpoints; Linear personal API-key fallback retains its required raw
  `Authorization` value. Jira OAuth requires a validated Cloud ID and
  Bearer authorization at
  `https://api.atlassian.com/ex/jira/{cloudId}`; Jira email/API-token fallback
  retains Basic authorization against the configured tenant origin. Provider
  requests use fixed HTTPS boundaries, bounded timeouts and responses, complete
  bounded pagination, checksummed target-bound feature state, stable create
  markers, and deterministic per-effect keys. Discovery catalogs are ephemeral
  and preview validates target access before persistence. Off/disabled branches
  occur before authentication resolution.
- Tracker evidence is selected only through receipt IDs already committed in
  local workflow state. Receipt and file digests, repository containment,
  regular-file/non-symlink identity, secret-like names, media allowlists, count,
  and byte ceilings are revalidated before provider access. Uploads use
  deterministic reconciliation names; durable repository links are commit
  pinned and emitted only when committed bytes match. No artifact bytes enter
  pending state. Diagnostics are bounded and credential-redacted before return
  or persistence, including failures raised by an injected transport. Remote
  input is never allowed to mutate local workflow state or acceptance criteria.
- Reserved migration stage/marker/backup paths are transaction state rather
  than source. Pre-marker failure removes only its owned stage; evidence,
  knowledge, and integration overlays exclude scratch, while Doctor diagnoses
  orphans without deleting them.
- Global uninstall is confirmation-gated and derives every candidate from the
  pinned catalog under the validated user home. It removes only regular files
  carrying Empirical's managed marker and valid owner-stamped metadata, never
  follows symlinks, never searches repositories, and invokes exact npm package
  removal only after managed integration cleanup succeeds.
- Global installation exposes only the narrowly scoped `empirical-init` skill.
  Project activation validates completed Schema 5 configuration, ignores
  read-only prompts, never initializes implicitly, and changes instruction or
  skill files only through contained marker-owned writes that preserve
  unmatched markers and unmanaged collisions.
- Doctor never repairs, deletes, prunes, launches, or writes.
- Delivery uses ordinary GitHub PR merges and declared required checks. It has
  no admin, protection-bypass, force-push, credential-discovery, or hidden
  cleanup path.
- Publication requires an exact explicit version, commit, tag, dist-tag,
  literal approval, and authorization bound to the complete request. Empirical
  independently queries remote state before and after mutation. Existing
  conflicting immutable tags, releases, npm versions, or dist-tags block the
  operation.
- YOLO changes question frequency, not authority. It never bypasses host
  permissions or branch protection, extracts credentials, infers publication,
  replaces immutable artifacts, or deletes real worktrees/branches.
- Decision files reject hidden-reasoning, prompt-transcript, credential, and
  secret sections. Explain exposes deterministic state-machine rationale only.

Do not place secrets in requests, chat, Socratic answers, specifications,
decisions, evidence summaries, screenshots, tracker configuration, tool input,
tool output, commands, shell history, process arguments, or delivery inputs.
**Never paste credentials into chat.** Tracker credential fields contain
environment-variable names, never values. New defaults are
`LINEAR_SECRET_KEY`, `GITHUB_TOKEN`, and the Jira pair `JIRA_EMAIL` plus
`JIRA_API_TOKEN`; historical or custom valid names remain supported.
`.empirical/` is committed project data; Git-common-dir claim records are local
coordination metadata.
