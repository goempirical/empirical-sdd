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

The single `empirical` skill can be installed across 73 global agent targets. Skill-file
compatibility does not imply MCP configuration or executable handoff support.

## Important tool groups

- Setup and context: `empirical_init`, `empirical_adopt`,
  `empirical_configure`, `empirical_policy`, `empirical_context`,
  `empirical_doctor`, `empirical_migrate`.
- Discovery and routing: `empirical_explore`, `empirical_discovery`,
  `empirical_route`, `empirical_fast`, `empirical_complex`, `empirical_yolo`.
- Exact workflow: `empirical_loop`, `empirical_next`, `empirical_status`,
  `empirical_explain`, `empirical_complete`, `empirical_retry`.
- External ticket mirror: `empirical_tracker_configure`,
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

1. Inspect setup without writing, show the complete settings, and persist only
   after confirmation.
2. Resume selected non-terminal work before treating request text as new work.
3. Use five-pass discovery only for material ambiguity or when the `$empirical`
   request explicitly asks for an interview.
4. Call `empirical_route`; Fast is legal only at the contract-neutral floor.
5. In YOLO, obey the recorded ceiling and ask only for a product blocker,
   missing permission, or hard safety boundary.
6. If start returns a worktree proposal, display and obtain literal approval
   before creation.
7. Execute configured evidence or collect artifacts, then complete the exact
   revision with immutable receipt IDs.
8. If tracking is configured, commit the local transition first and then call
   `empirical_tracker_sync`. A remote failure is reported and retried from the
   durable pending projection; it never rewinds or blocks local workflow state.
9. When Context is returned, call `empirical_context`, refine every reported
   placeholder topic from inspected evidence, remove its managed marker, call
   context again, and complete only when `refinementRequired`, `stale`, and
   `missing` are empty.
10. For Complex work, integrate against an independent target worktree. Deliver
   only when Policy and authorization cover it. Never infer publication.

Read operations, proposals, and Doctor do not mutate. Worktree creation,
configured command execution, integration, delivery, and publication are
explicitly effectful and retain their own safety gates.

## External ticket mirror

Tracking is opt-in. With no `.empirical/tracker.json`, status is `local-only`
and tracker operations perform no network requests. `empirical_tracker_configure`
accepts one strict Tracker Policy v1 document, or `null` to disable tracking.
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

Provider-specific policy fields are:

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
start with a letter, and contain at least one underscore. The host must inject
a nonblank runtime value into the Empirical MCP/agent process. The credential
must be authorized for the exact configured target and effects:

- Linear: read, create, and update issues in the configured team and optional
  project.
- GitHub: read and write the configured repository's issues and comments, and
  add/update items and the Status field in the configured Projects v2 project.
- Jira: read, create, and update issues and issue properties, and perform the
  configured status transitions in the configured Cloud project.

Empirical does not discover credentials, elevate provider permissions, or
serialize runtime values. Missing variables are reported by name only.

`empirical_tracker_bind` accepts `{ "mode": "create" }` or
`{ "mode": "attach", "ticket": "..." }`. An existing binding is immutable
unless the caller explicitly supplies `replace: true`. Bindings and pending
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

The remote marker contains feature identity, phase, workflow status, exact
revision, completion level, blocker summary, and an idempotency marker. Status
and action packets report `local-only`, `synced`, `pending`, or `failed` without
making remote requests. They retain the committed, last-synchronized, and
pending revisions plus a bounded credential-safe failure code, summary, and
timestamp. Keep local progress; provide a named missing credential, explicitly
rebind target drift, reconcile an ambiguous create, or call
`empirical_tracker_sync` again for an ordinary pending update as reported.

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
