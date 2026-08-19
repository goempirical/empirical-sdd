# MCP usage

Empirical exposes its registry-backed internal API over stdio:

```json
{
  "mcpServers": {
    "empirical": {
      "command": "empirical",
      "args": ["mcp"]
    }
  }
}
```

The single explicit `empirical-init` skill can be installed across 73 global
agent targets. Initialization writes marker-owned local activation for verified
repository hosts; skill-file compatibility does not imply MCP configuration or
executable handoff support.

## Important tool groups

- Setup and context: `empirical_init`, `empirical_adopt`,
  `empirical_configure`, `empirical_policy`, `empirical_context`,
  `empirical_doctor`, `empirical_migrate`.
- Discovery and routing: `empirical_explore`, `empirical_discovery`,
  `empirical_route`, `empirical_fast`, `empirical_complex`, `empirical_yolo`.
- Exact workflow: `empirical_loop`, `empirical_next`, `empirical_status`,
  `empirical_explain`, `empirical_complete`, `empirical_retry`.
- External ticket mirror: `empirical_tracker_discover`,
  `empirical_tracker_suggest`, `empirical_tracker_preview`, `empirical_tracker_configure`,
  `empirical_tracker_bind`, `empirical_tracker_sync`.
- Evidence and integration: `empirical_evidence_execute`,
  `empirical_evidence_collect`, `empirical_verify`, `empirical_integrate`,
  `empirical_capabilities`.
- External ceilings: `empirical_deliver`, `empirical_publish`.
- Isolation and handoff: `empirical_handoff`, `empirical_worktree_propose`,
  `empirical_worktree_create`, `empirical_integrations`.

Tool names, descriptions, profiles, modes, internal CLI verbs, and skill entry
operations are derived from one registry and checked for exact parity. The
legacy `empirical_archive` boundary remains callable only to return the explicit
Schema-5 integration requirement.

## Agent contract

1. Invoke `empirical-init` explicitly for setup or repair. Inspect without
   writing, show the complete settings, and persist only after confirmation.
   Init stops without creating feature state.
2. In a valid initialized repository, ordinary mutation prompts automatically
   use the local workflow. Read-only prompts do not. Resume selected
   non-terminal work before treating request text as new work.
3. Use five-pass discovery only for material ambiguity or explicit Socratic use.
4. Call `empirical_route`; Fast is legal only at the contract-neutral floor.
5. In YOLO, obey the recorded ceiling and ask only for a product blocker,
   missing permission, or hard safety boundary.
6. If start returns a worktree proposal, display and obtain literal approval
   before creation.
7. Execute configured evidence or collect artifacts, then complete the exact
   revision with immutable receipt IDs.
8. If tracking is configured, commit the local transition first and then call
   `empirical_tracker_sync`. In `ensure` mode this also establishes the one
   feature ticket. A remote failure is reported and retried from the durable
   unacknowledged effect; it never rewinds or blocks local workflow state.
9. When Context is returned, call `empirical_context`, refine every reported
   placeholder topic from inspected evidence, remove its managed marker, call
   context again, and complete only when `refinementRequired`, `stale`, and
   `missing` are empty.
10. For Complex work, integrate against an independent target worktree. Deliver
   only when Policy and authorization cover it. Never infer publication.

Read operations, proposals, and Doctor do not mutate. Worktree creation,
configured command execution, integration, delivery, and publication are
explicitly effectful and retain their own safety gates.

## OAuth and host fallback boundary

Tracker authentication is OAuth-first when the embedding host supplies a
`TrackerOAuthResolver`. The resolver owns provider application registration,
callbacks, token refresh/revocation, and encrypted custody; Empirical receives
only one strictly validated in-memory credential for the current operation.
The default stdio process has no hosted broker and does not pretend otherwise.

```ts
import { createMcpServer } from "empirical-sdd/mcp";

const server = createMcpServer(repositoryRoot, {
  trackerDependencies: { oauthResolver: trustedHostResolver },
});
```

If the resolver reports that authorization is required, Empirical validates a
secret-free HTTPS handoff and inspects the connected client's negotiated
capabilities. It calls `elicitation/create` only when `elicitation.url` is
explicitly declared and sends only `mode: "url"`, a message, an opaque ID, and
the URL. A form-only declaration, legacy empty `elicitation: {}`, absent
capability, decline, cancellation, or handoff failure never causes a form or a
credential request. Resolution then continues through the host fallback.

> **Never paste credentials into chat.** Raw credentials are not valid MCP
> arguments or results. If OAuth is unavailable, edit the host file directly:
> `${XDG_CONFIG_HOME:-$HOME/.config}/empirical/secrets.env` on POSIX or
> `%APPDATA%\Empirical\secrets.env` on Windows. Do not put a value in a command,
> shell history, process argument, repository file, assistant message, or tool
> call.

New setup names `LINEAR_SECRET_KEY`, `GITHUB_TOKEN`, and the Jira pair
`JIRA_EMAIL` plus `JIRA_API_TOKEN`. Resolution is atomic by source: connected
OAuth, then a complete injected environment set, then a complete checked file
set. The file must be outside the repository, at most 64 KiB, a regular
non-symbolic-link file, strictly formatted, and owner-only on POSIX. Existing
policies naming `LINEAR_API_KEY` or another valid variable remain unchanged.

## External ticket mirror

With no `.empirical/tracker.json`, tracker setup is unconfigured while status
remains `local-only` and tracker operations perform no network requests. The
strict provider-free disabled record represents an explicit No tracking choice
with the same runtime behavior. Policy v2 with `ticket:
"off"` reports `off` and also branches before credential resolution or provider
access. `empirical_tracker_configure` accepts a strict Tracker Policy v1 or v2
document, or `null` to persist No tracking.

User-facing Init first requires Track all work (recommended) or No tracking
when no prior choice exists. Setup then uses the same contract in every client:

1. Start with the trusted host OAuth connection. If it is unavailable, show
   the exact host file path and fallback variable names above, pause while the
   human edits the file outside chat, and resume only after host-side
   confirmation. Then call `empirical_tracker_discover` with a provider and
   fallback environment-variable names. Jira also needs its credential-free Cloud site
   origin. The result contains named workspaces/sites, teams/repositories,
   projects, issue types, fields, states, parent relationships, and adapter
   capabilities; no catalog is persisted.
2. Call `empirical_tracker_suggest` with the same discovery input and the
   selected team/status-field/project parent ID. Linear state `type` and
   lifecycle `position` are primary; familiar names only refine compatible
   candidates. Explicitly resolve ties or incompatible-only results. Reusing a
   state across phases is valid.
3. Call `empirical_tracker_preview` with the complete policy. Preview repeats
   discovery, validates permissions and every selected target/state, expands
   display names, and returns a canonical secret-free digest without writing.
4. Apply with `empirical_tracker_configure`, or pass the strict `tracker`
   preserve/disabled/apply change to `empirical_init`. The private CLI has
   equivalent `tracker-discover`, `tracker-suggest`, `tracker-preview`, `tracker-configure`, and
   `init --tracker-input <json-file|->` surfaces.

The common state map is required for every provider:

```json
{
  "specification": "provider-status-id",
  "planned": "provider-status-id",
  "in-progress": "provider-status-id",
  "verification": "provider-status-id",
  "review": "provider-status-id",
  "blocked": "provider-status-id",
  "done": "provider-status-id"
}
```

Tracker Policy v2 adds behavior without changing provider target shapes:

```json
{
  "schemaVersion": 2,
  "provider": "linear",
  "target": { "teamId": "discovered-team", "projectId": "discovered-project" },
  "credentialEnv": { "apiKey": "LINEAR_SECRET_KEY" },
  "states": { "specification": "todo", "planned": "todo", "in-progress": "started", "verification": "qa", "review": "qa", "blocked": "started", "done": "done" },
  "ticket": "ensure",
  "visibility": "milestones"
}
```

`ticket` is `off`, `manual`, or `ensure`. `visibility` is `blockers-final`,
`milestones`, or `revisions`. Provider-specific legacy v1 examples follow; they
remain accepted byte-for-byte and are interpreted as manual binding with the
legacy state/description projection:

```json
{
  "schemaVersion": 1,
  "provider": "linear",
  "target": { "teamId": "team-id", "projectId": null },
  "credentialEnv": { "apiKey": "LINEAR_API_KEY" },
  "states": { "specification": "...", "planned": "...", "in-progress": "...", "verification": "...", "review": "...", "blocked": "...", "done": "..." }
}
```

```json
{
  "schemaVersion": 1,
  "provider": "github",
  "target": { "owner": "org", "repository": "repo", "projectId": "PVT_...", "statusFieldId": "PVTSSF_..." },
  "credentialEnv": { "token": "GITHUB_TOKEN" },
  "states": { "specification": "option-id", "planned": "option-id", "in-progress": "option-id", "verification": "option-id", "review": "option-id", "blocked": "option-id", "done": "option-id" }
}
```

```json
{
  "schemaVersion": 1,
  "provider": "jira",
  "target": { "siteUrl": "https://example.atlassian.net", "projectKey": "ENG", "issueTypeId": "10001" },
  "credentialEnv": { "email": "JIRA_EMAIL", "apiToken": "JIRA_API_TOKEN" },
  "states": { "specification": "status-id", "planned": "status-id", "in-progress": "status-id", "verification": "status-id", "review": "status-id", "blocked": "status-id", "done": "status-id" }
}
```

Linear's `projectId` key is required. Use a provider project id string to pin
the mirror to that project, or the literal JSON value `null` for a team-only
ticket; do not omit the key or use the string `"null"`.

Every `credentialEnv` value is an environment-variable **name**, never a
credential. Names are 3–64 uppercase ASCII letters, digits, or underscores,
start with a letter, and contain at least one underscore. OAuth remains the
preferred runtime source; the named nonblank value is consulted only as a
fallback from injected host state or the guarded host file. The resulting
credential must be authorized for the exact configured target and effects:

- Linear: discover the workspace/team/project/workflow, and read, create,
  update, and comment on issues in the selected team and optional project.
- GitHub: read and write the configured repository's issues and comments, and
  discover/add/update items and the Status field in the selected Projects v2
  project.
- Jira: discover projects, issue types, fields, and statuses; read, create,
  update, and comment on issues; write issue properties; perform configured
  transitions; and add attachments when evidence upload is enabled.

Empirical does not discover credentials, elevate provider permissions, mutate
the process environment, or serialize runtime values. Missing authentication
is reported with names and the concrete host path only. Linear OAuth uses a
Bearer header while its personal API-key fallback retains Linear's raw
`Authorization` value. Jira OAuth uses Bearer authorization at
`https://api.atlassian.com/ex/jira/{cloudId}`; Jira fallback uses the configured
tenant origin with Basic authorization.

In `manual` mode, `empirical_tracker_bind` accepts `{ "mode": "create" }` or
`{ "mode": "attach", "ticket": "..." }`. In `ensure` mode ordinary
`empirical_tracker_sync` first validates one ticket URL referenced by the
feature request, then performs a complete bounded lookup for the stable feature
marker, and creates only after a complete zero-match result. Multiple references
or marker matches persist `TRACKER_BIND_AMBIGUOUS` and stop for explicit
reconciliation. An existing binding is immutable unless the caller explicitly
supplies `replace: true`. Bindings and pending
operations are checksummed, feature-local, and retain digests of the exact
provider target and effective policy. A target change therefore fails locally
until explicit replacement; a same-target state-map change invalidates the
same-revision acknowledgment and projects the committed state through the new
mapping.

Pending work is the durable reconciliation source. Normal synchronization
resumes that exact operation before deriving newer work. A durable `dispatched`
flag distinguishes a create intent that has never been sent from one that may
have reached the provider. Sync may send the first create only while the intent
is durably undispatched; after marking it dispatched, Empirical never sends
that create again automatically. `empirical_tracker_sync` instead performs a
bounded lookup for the exact persisted create marker. If no unique match can be
reconciled, the caller can attach the possibly created ticket. Supplying
`confirmCreateRetry: true` explicitly accepts a new create attempt and its
duplicate-ticket risk; it is not an exactly-once guarantee.

Policy v2 progress is append-only. Linear, GitHub, and Jira receive idempotent
milestone comments containing phase, revision, progress, completion, concise
summary, blocker, and reviewable receipt artifacts. The visibility policy
selects blockers/final only, phase/status/completion milestones, or every
committed revision. New Linear synchronization changes state and comments only;
it never rewrites user-authored descriptions. Deterministic transition,
comment, and artifact keys include feature, revision, and sorted receipt digest,
and each successful effect is atomically acknowledged before the next.

Only artifacts already approved by committed collected-evidence receipts are
eligible. Empirical revalidates receipt and file digests, repository containment,
regular-file/non-symlink identity, secret-like names, media allowlists, and size
bounds before any remote request. Jira uses a deterministic attachment marker;
other adapters use a commit-pinned safe repository link when available and
otherwise record a bounded unsupported/pending note. No bytes or credential
values enter pending JSON.

Status and action packets report `local-only`, `off`, `synced`, `pending`, or
`failed` without provider requests. Policy v2 status also shows ticket behavior,
visibility, and remaining effects. Keep local progress; provide a named missing
credential, explicitly rebind target drift, resolve marker ambiguity, repair an
unsafe artifact, or retry `empirical_tracker_sync` after an outage as reported.

The normalized projection is `shape/specify/design → specification`,
`plan → planned`, `implement/context → in-progress`, `verify → verification`,
review/integration/delivery phases → `review`, terminal success → `done`, and
`blocked` or `awaiting_human` → `blocked`.

## Policy v2

`empirical_configure` accepts the strict Policy v2 document:

```json
{
  "schemaVersion": 2,
  "context": ["README.md"],
  "phases": {},
  "verification": {
    "evidence": {
      "required": true,
      "browserForUi": true,
      "screenshotForUi": true,
      "codeReview": true
    },
    "commands": [
      {
        "id": "test",
        "argv": ["npm", "test"],
        "cwd": ".",
        "timeoutMs": 300000,
        "maxOutputBytes": 262144,
        "evidenceKinds": ["test", "review"],
        "criteria": []
      }
    ]
  },
  "delivery": null,
  "preferredAgent": null
}
```

Shell launchers and shell-control arguments are rejected. Delivery, when
enabled, is `{ "provider": "github", "targetBranch": "main",
"requiredChecks": ["test"] }`.
