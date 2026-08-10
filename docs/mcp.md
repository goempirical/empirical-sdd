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
3. Use five-pass discovery only for material ambiguity or explicit Socratic use.
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
  "target": { "teamId": "team-id", "projectId": "project-id-or-null" },
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

`empirical_tracker_bind` accepts `{ "mode": "create" }` or
`{ "mode": "attach", "ticket": "..." }`. An existing binding is immutable
unless the caller explicitly supplies `replace: true`; an ambiguous create
requires `confirmCreateRetry: true` before another create request. The binding
and pending projection are checksummed and feature-local. The remote marker
contains feature identity, phase, workflow status, exact revision, completion
level, blocker summary, and an idempotency marker. Status and action packets
report `local-only`, `synced`, `pending`, or `failed` without making remote
requests.

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
