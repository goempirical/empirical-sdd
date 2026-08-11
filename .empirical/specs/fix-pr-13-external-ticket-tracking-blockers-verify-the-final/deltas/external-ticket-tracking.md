## MODIFIED Requirements

### Requirement: Tracking is optional and one-way

Empirical SHALL default to local-only tracking and MUST perform no provider
request without explicit project configuration and an explicit bind or
synchronization operation. Ordinary synchronization requires a target-matching
binding; without one, it MAY resume or reconcile already-durable bind work but
MUST NOT invent a create. GitHub, Linear, and Jira tickets are projections only:
remote data MUST NOT mutate, advance, pause, retry, reroute, or complete local
workflow state.

#### Scenario: A remote ticket is moved manually

- **WHEN** its status differs from the bound Empirical feature
- **THEN** the next outbound projection restores the configured Empirical state
- **AND** no Empirical revision is created from the remote change

#### Scenario: Synchronization finds no binding or durable bind intent

- **WHEN** tracking is configured for an active feature but no binding or
  pending bind operation exists
- **THEN** synchronization performs no provider request and creates no ticket
- **AND** local workflow state remains authoritative

### Requirement: Feature bindings are explicit and secret-free

The single Empirical skill SHALL create at most one active provider-ticket
association for a feature by creating or attaching through granular tracker
operations. A binding MUST contain only canonical provider-target and policy
identity, validated remote identity, a credential-free provider URL, bounded
provider reconciliation identifiers, and synchronization revisions. Attach and
provider responses MUST be validated against the configured repository, team
and optional project, or Jira site, project, and issue type before association.
Changing the configured target MUST fail locally without applying an old remote
identity to the new target. Rebinding requires an explicit replacement
operation; credential values and authorization material MUST NOT be persisted.

#### Scenario: A feature is attached to an existing ticket

- **WHEN** the provider validates the supplied remote identity and target
- **THEN** Empirical records one immutable target/provider/remote-id association
- **AND** queues the current committed revision for projection

#### Scenario: A provider is reconfigured to a different target

- **WHEN** an existing binding's target identity differs from current policy
- **THEN** status and synchronization report target drift without a provider
  request
- **AND** the old remote identity is not reused until explicit replacement and
  revalidation

#### Scenario: Persisted provider identifiers or URLs are forged

- **WHEN** stored opaque mutation identifiers or the stored ticket URL do not
  resolve to the configured target and bound identity
- **THEN** Empirical refuses the mutation and does not expose the unsafe URL
- **AND** any provider-specific mutation identifier is re-derived from validated
  remote state before use

### Requirement: Remote effects follow local commits

Empirical MUST commit its journal event and state projection before attempting
a ticket effect. Provider failure MUST leave the local revision successful and
create or retain reconstructable, durable, secret-free pending work with a
stable attempt key. Pending create or attach intent MUST be persisted before
the remote effect and remain the reconciliation source after interruption. A
durable dispatch flag MUST distinguish an unsent create intent from one that
may have reached the provider. Retry MAY send the initial request only while
that intent is durably undispatched. Once marked dispatched, Empirical MUST NOT
send that create again automatically and MUST instead perform a bounded
provider-specific lookup for the exact persisted attempt marker. Without one
unique match, the caller must attach the possibly created ticket using that
exact marker or explicitly confirm a new create attempt while acknowledging
that it may create a duplicate.

#### Scenario: The provider is unavailable during phase completion

- **WHEN** the local phase passes and the outbound request fails
- **THEN** the next Empirical action reflects the advanced local revision
- **AND** tracker health reports durable pending or failed work that can be retried

#### Scenario: A ticket-create response is not observed

- **WHEN** a dispatched create may have succeeded but no valid binding was obtained
- **THEN** safe retry preserves and reports the durable ambiguous create intent
- **AND** it performs exact-marker reconciliation without a second create request

#### Scenario: Exact create reconciliation is inconclusive

- **WHEN** the bounded provider lookup returns zero matches, multiple matches,
  malformed data, or incomplete pagination
- **THEN** Empirical preserves the original attempt and fails closed
- **AND** another create requires explicit duplicate-risk confirmation and a new
  attempt key

#### Scenario: A durable attachment initially fails

- **WHEN** an attach cannot finish because credentials or the provider are unavailable
- **THEN** synchronization retries that same validated ticket intent
- **AND** it does not create a replacement ticket

#### Scenario: Projection fails after a valid create binding is persisted

- **WHEN** ticket creation and identity validation succeed but state projection fails
- **THEN** Empirical retains the binding and durable pending projection
- **AND** recovery is reported as an ordinary projection retry rather than an
  ambiguous create

### Requirement: Progress projection is exact and configurable

Empirical SHALL normalize its phases and stop conditions into documented
progress states, then resolve those states only through the project's explicit
provider mapping. Every projection MUST carry one provider-owned marker and the
feature, phase, workflow status, revision, highest completion level, and any
bounded blocked or awaiting-human summary. The effective target and complete
state mapping MUST participate in synchronization acknowledgment so a
same-target mapping change invalidates the same-revision fast path and
reprojects the committed state. Human-authored provider content outside the
exact owned marker or provider-owned property MUST be preserved.

#### Scenario: Verification requires human input

- **WHEN** the feature commits an `awaiting_human` Verify revision
- **THEN** the configured remote state is selected deterministically
- **AND** the remote Empirical marker identifies the exact Verify revision and gate

#### Scenario: A state mapping changes without a new local revision

- **WHEN** the target is unchanged but the configured state identifier differs
  from the last acknowledged projection policy
- **THEN** synchronization projects the committed revision using the new mapping
- **AND** acknowledges the new mapping only after the provider update succeeds

#### Scenario: Human text coexists with the managed projection

- **WHEN** a Linear description surrounds one balanced Empirical marker or a
  Jira issue has a user-authored description alongside the Empirical property
- **THEN** projection replaces only the Linear managed block or Jira managed property
- **AND** preserves the human-authored description

### Requirement: Provider adapters share one validated contract

GitHub, Linear, and Jira adapters MUST implement the same create, attach,
project, and transition contract over an injectable, size-bounded, timeout-
bounded HTTP transport. The public CLI and MCP bind surfaces MUST apply a strict
runtime-discriminated create-or-attach contract before project mutation, and
their advertised schemas MUST expose the strict provider-policy alternatives
and mode-specific bind fields. Configure, bind, and sync operation metadata MUST
identify those operations as mutating. Adapters MUST resolve authentication
from documented environment variables at call time. Credential names MUST match
`^(?=.{2,64}$)[A-Z][A-Z0-9]*_[A-Z0-9_]+$`; their nonblank values and provider
permissions come only from the host runtime and are never granted by
configuration. Adapters MUST validate response envelopes, bodies, identities,
targets, safe URLs, warnings, and pagination; redact every stored failure,
including an injected-transport exception; and make provider differences
explicit rather than inferring workflow identifiers.

#### Scenario: A public bind request mixes modes

- **WHEN** a caller supplies unknown fields or create-only fields to attach, or
  attach-only fields to create
- **THEN** CLI and MCP validation reject the request before opening the project
- **AND** no tracker file or provider state changes

#### Scenario: A provider returns malformed success data

- **WHEN** a create or update response lacks its required target-bound remote identity
- **THEN** the adapter records a safe synchronization failure
- **AND** no invalid binding or synchronized revision is persisted

#### Scenario: GitHub reconciles an ambiguous create

- **WHEN** reconciliation scans the configured repository's issues
- **THEN** pull requests and non-exact markers are excluded and pagination must
  complete before one exact issue can be accepted
- **AND** project membership and an exact machine-owned comment are revalidated
  before mutation

#### Scenario: Linear reconciles an ambiguous create

- **WHEN** reconciliation searches by the durable attempt marker
- **THEN** every candidate is validated against the configured team and optional
  project and pagination must be complete
- **AND** only one exact marker can establish the binding

#### Scenario: Jira reconciles an ambiguous create

- **WHEN** enhanced JQL searches the configured project for the durable issue property
- **THEN** every candidate is validated against the configured project and issue
  type and the exact property marker
- **AND** any warning, malformed page, or incomplete pagination prevents binding

#### Scenario: A provider failure contains a runtime credential

- **WHEN** an HTTP response or injected transport exception echoes an exact
  credential value
- **THEN** Empirical replaces that value before constructing durable diagnostics
- **AND** only the configured environment-variable name may remain observable

### Requirement: Tracker health is observable

Structured and human status/action output MUST report `local-only`, `pending`,
`synced`, or `failed` plus safe provider and URL data, committed revision,
last-synchronized revision, pending revision, and bounded failure code, summary,
and timestamp when applicable. Recovery reporting MUST distinguish target
drift, ambiguous create, missing runtime credentials, and an ordinary retryable
synchronization failure. Status and Doctor inspection MUST remain local and
MUST NOT contact the provider; Doctor MUST validate dormant binding and pending
files even when policy is absent and MUST NOT repair or mutate them.

#### Scenario: All pending projections are acknowledged

- **WHEN** synchronization converges through the current committed revision
- **THEN** status reports `synced` with matching committed and synchronized revisions
- **AND** repeated status reads perform no network request

#### Scenario: Tracking is disabled after durable state exists

- **WHEN** Doctor inspects dormant binding or pending files without tracker policy
- **THEN** it reports any path, schema, URL, or digest failure alongside local-only health
- **AND** file contents and repository state remain byte-for-byte unchanged

#### Scenario: Recovery needs an operator action

- **WHEN** tracker health is failed because of target drift, an ambiguous create,
  or a missing runtime credential
- **THEN** both structured and human output preserve the bounded failure facts
- **AND** human output gives the matching safe recovery action without revealing
  credential values
