# Design: External Ticket Tracking and One Empirical Skill

## Design goals

This change adds a deliberately asymmetric integration boundary. Empirical is
the only workflow authority; GitHub, Linear, and Jira receive a projection of a
committed revision. Provider availability must never become part of the local
transaction, and provider state must never be interpreted as an SDD command.

The human interaction contract is reduced at the same time. One generated
`empirical` skill owns setup, discovery, routing, normal or bounded-autonomy
execution, handoff, optional tracker setup, synchronization, and terminal
reporting. The operation registry and MCP server remain granular because exact
machine operations retain narrower schemas, revision checks, annotations, and
testable safety boundaries.

The design follows current provider contracts:

- GitHub issues are created and read through the versioned REST issue API;
  Projects v2 items and single-select fields are updated through the official
  GraphQL `addProjectV2ItemById` and `updateProjectV2ItemFieldValue` mutations.
- Linear uses its GraphQL `issueCreate` and `issueUpdate` mutations; workflow
  state is an explicit `stateId`.
- Jira Cloud creates and edits issues through REST v3, while status changes use
  the dedicated transitions API rather than issue editing.

Provider requests are isolated behind an injectable transport. Repository CI
therefore proves exact request shapes and response validation without live
accounts or network access.

## Boundaries and module layout

| Module | Responsibility |
| --- | --- |
| `src/tracking.ts` | Strict Tracker Policy v1, normalized progress projection, secret checks, binding/pending persistence, health derivation, provider reconciliation, and injectable HTTP transport |
| `src/core.ts` | Expose configure/bind/sync application methods; add local tracker health to status and action packets; never read inbound provider state as workflow input |
| `src/storage.ts` | Contained paths and existing atomic JSON primitives used by tracker files; workflow journal semantics remain unchanged |
| `src/protocol.ts` | Shared tracker-facing packet schemas/types and canonical digest helpers; Schema 5 workflow state remains unchanged |
| `src/operations.ts` | Register configure/bind/sync tracker MCP operations and exactly one user-facing skill |
| `src/mcp.ts` | Strict granular tracker tool inputs and default fetch/environment dependencies |
| `src/cli.ts` | Private internal tracker transport and tracker-aware rendering; public lifecycle help remains unchanged |
| `src/integrations.ts` | Render only the registry's `empirical` skill and remove every marker-owned obsolete skill safely |
| `src/doctor.ts` | Read-only tracker policy, binding, pending-work, and credential-presence diagnostics without contacting providers |

`tracking.ts` may use protocol digest helpers and storage's contained atomic
primitives. Neither protocol nor storage imports provider code. Core composes
the service, while CLI and MCP remain adapters.

## Persisted model

Tracker documents are independently versioned. Their absence is valid and
means local-only, so existing Schema-5 repositories require no workflow schema
migration.

### Project policy

`.empirical/tracker.json` is either absent or a strict discriminated object:

```json
{
  "schemaVersion": 1,
  "provider": "linear",
  "target": {
    "teamId": "team-uuid",
    "projectId": "project-uuid"
  },
  "credentialEnv": {
    "apiKey": "LINEAR_API_KEY"
  },
  "states": {
    "specification": "state-uuid",
    "planned": "state-uuid",
    "in-progress": "state-uuid",
    "verification": "state-uuid",
    "review": "state-uuid",
    "blocked": "state-uuid",
    "done": "state-uuid"
  }
}
```

Provider targets are explicit:

- GitHub: owner, repository, Projects v2 node id, Status field node id, API
  base, `GITHUB_TOKEN`-style environment-variable name, and seven option ids.
- Linear: team id, optional project id, API endpoint, `LINEAR_API_KEY`-style
  environment-variable name, and seven workflow-state ids.
- Jira: HTTPS site URL, project key, issue type id, email and API-token
  environment-variable names, and seven destination status ids. The adapter
  queries available transitions and selects one whose destination status id
  equals the configured id.

All schemas are strict. Environment-variable names use a conservative uppercase
identifier grammar. URLs reject credentials, query strings, fragments, and
non-HTTPS origins. Unknown keys—including apparent token/password/header
fields—fail before writes. No environment value is serialized.

### Feature binding and pending projection

Each tracked feature stores:

```text
.empirical/specs/<feature>/tracker/
├── binding.json
└── pending.json
```

`binding.json` records schema version, feature, provider, remote id/key, safe
URL, provider reconciliation ids (for example GitHub project item/comment ids),
last synchronized revision/digest, and bounded last-failure metadata.
`pending.json` records the latest exact projection, stable idempotency key,
attempt count, and digest. It contains no response headers, cookies, request
authorization, or raw provider body.

The authoritative workflow state plus binding is also a crash-gap witness. If
the current revision exceeds both pending and synchronized revisions, status
reports `pending`, and the next synchronization reconstructs `pending.json`
atomically before any remote request. Terminal journal compaction cannot lose
the pending projection because it lives outside the event directory.

An existing binding is immutable unless a dedicated call supplies literal
`replace: true`. Replacement never happens as a side effect of configuration or
normal synchronization.

## Normalized projection

The provider-independent states are:

| Empirical state | Normalized tracker state |
| --- | --- |
| `shape`, `specify`, `design` | `specification` |
| `plan` | `planned` |
| `implement`, `context` | `in-progress` |
| `verify` | `verification` |
| `review`, `integrate`, `deliver`, `publish`, `archive` | `review` |
| terminal `done` | `done` |
| any `blocked` or `awaiting_human` | `blocked` |

Each pending projection contains a stable marker
`empirical-sdd:<feature>:r<revision>`, feature, exact phase, workflow status,
revision, highest completion level, normalized state, bounded summary, and a
canonical digest. Its idempotency key is derived from repository identity,
feature, revision, provider, remote id when known, and projection digest.

The provider adapter resolves the normalized state only through the explicit
seven-entry mapping. It does not guess state names, create board workflows, or
fall back to provider defaults.

## Commit and synchronization sequence

Local workflow methods retain their current transaction:

```text
validate exact revision
  -> append journal event
  -> atomically write state projection
  -> return committed action with locally derived tracker health
  -> $empirical calls granular tracker sync
```

Tracker synchronization is a separate operation:

```text
read committed state + strict policy + binding
  -> reconcile or atomically create pending.json
  -> resolve credentials from the process environment
  -> provider reconcile using stable marker/idempotency key
  -> validate the response
  -> atomically advance binding.lastSyncedRevision
  -> remove/acknowledge pending only after binding persistence
```

Provider errors are caught at this boundary. The operation writes a bounded,
redacted failure and returns tracker health `failed`; it never invokes a
workflow transition. Retrying reads the same pending digest. If another local
revision has committed, a successful earlier projection is acknowledged before
the newer projection replaces it.

Creation has a stricter ambiguity rule. The stable feature marker is persisted
before the request. A retry reconciles/searches that marker first. If a create
request may have succeeded but no response arrived, Empirical does not issue a
second blind create; it remains failed/pending until reconciliation finds the
ticket or the user explicitly confirms a replacement attempt. Normal updates
are idempotent set/upsert operations.

## Provider reconciliation

### GitHub

1. Create an issue with the stable feature marker or validate the attached
   issue through REST.
2. Add/locate it in the configured Projects v2 project through GraphQL.
3. Upsert one marker comment containing the exact projection.
4. Set the configured Status single-select option through
   `updateProjectV2ItemFieldValue` and pass the stable key as
   `clientMutationId`.
5. Store only issue node/number, safe URL, project item id, and marker comment
   id.

### Linear

1. Create with explicit team/project/state ids or query and validate the
   attached issue id/key.
2. Upsert a bounded Empirical marker block while preserving non-Empirical issue
   description content.
3. Set the exact configured `stateId` with `issueUpdate`.
4. Validate `success`, issue id, identifier, and URL before acknowledging.

### Jira

1. Create through REST v3 with project key and issue type or validate the
   attached issue key.
2. Upsert the exact projection in the `empirical-sdd` issue property so no user
   description is overwritten.
3. Read available transitions, select the transition whose destination id
   matches the mapped status id, and call the dedicated transition endpoint.
4. Validate the issue key and same-site browse URL before acknowledging.

Every adapter limits response size and stored diagnostics. Transport errors,
HTTP errors, GraphQL errors, and malformed successful payloads have stable safe
error codes.

## Tracker health and status

`TrackerStatus` is computed locally and added to action/status/explain packets:

- `local-only`: no enabled policy or no selected feature;
- `pending`: enabled and bound, with a committed revision newer than the
  acknowledged revision or durable pending work not yet attempted;
- `failed`: pending work has a bounded recorded failure;
- `synced`: binding acknowledgment equals the current committed revision and no
  pending work remains.

The packet includes provider, safe URL, committed revision, last synchronized
revision, pending revision, and safe error code/summary. Reading status never
resolves credentials and never contacts a provider.

## MCP and one-skill interaction

The operation registry adds:

- `tracker-configure`: validate and atomically store Tracker Policy v1;
- `tracker-bind`: create or attach one ticket and establish the binding;
- `tracker-sync`: reconcile the current committed projection.

They are MCP and private internal CLI operations, never public shell commands.
The generated `empirical` skill inspects local tracker health after every
returned workflow action. It synchronizes when configured/bound, explains
credential or provider failures without describing the local phase as failed,
and continues the SDD workflow unless a product decision or existing Empirical
safety gate requires the user.

`SKILLS` contains one definition. `integrations.ts` renders only that body and
derives installation counts from the registry. Its obsolete list includes all
five current dedicated skills and the older Explore/Fast/Complex names. Removal
retains existing marker, containment, symlink, and unmanaged-collision checks.
MCP operations such as Init, Discovery, Fast, Complex, Loop, YOLO, Complete,
Evidence, Integrate, and the new tracker tools remain independently callable by
the one skill.

## Compatibility and failure recovery

- Missing tracker files are a valid local-only default for every Schema-5
  repository, including terminal historical features.
- Tracker Policy v1 and binding files reject unknown versions; they do not
  trigger or broaden Schema-4-to-5 migration.
- Refresh removes obsolete managed skill files but never unmanaged lookalikes.
- A corrupt tracker file blocks tracker mutation and is diagnosed, while local
  workflow reads and transitions remain available with tracker health `failed`.
- A provider change does not rewrite existing bindings implicitly.
- No background daemon, webhook listener, or polling process is introduced.

## Verification strategy

`tests/tracking.test.ts` uses a recording transport and temporary repositories
to prove schemas, mapping, create/attach, each provider request sequence,
response validation, redaction, crash-gap reconstruction, retry/idempotency,
status health, and local revision survival. Existing integration, MCP, CLI,
package, consistency, doctor, and core suites are updated for one skill and
three new internal operations. The configured `ci` command supplies immutable
test/review evidence for AC-1 through AC-19.
