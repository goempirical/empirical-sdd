# Concise Ticket Policy Decisions

## D-001: Add an interaction setting without changing Schema 5

Status: Accepted

### Evidence

- Project configuration already normalizes missing nested evidence, isolation,
  and decision settings.
- Existing repositories expect the current expanded output.
- New setup can explicitly persist a recommended value without changing how an
  old missing field is interpreted.

### Options

1. Make all output concise unconditionally.
2. Introduce a new project schema solely for presentation preference.
3. Add a nested setting, normalize absence to detailed, and recommend concise
   only for new setup.

### Chosen approach

Choose option 3. Persist `interaction.questions` as `concise` or `detailed`,
default missing existing data to detailed, and place the effective value in
every action packet.

### Trade-offs and risks

- Existing repositories do not automatically become concise; they must opt in
  or rerun customization.
- Renderers must never use compact output to hide a safety gate, so concise
  summaries retain stops, failures, missing evidence, and completion actions.

### Verification

Load old fixtures, initialize new fixtures, configure through core/CLI/MCP,
and snapshot both render modes and action packet values.

## D-002: Extend Tracker Policy v2 with an optional strict matrix

Status: Accepted

### Evidence

- Policy v2 already carries global ticket behavior and visibility.
- A new policy version would cascade into unrelated binding, pending, and
  projection schemas that share the tracker record version.
- Strict optional keys can preserve every current v2 file and behavior.

### Options

1. Introduce Tracker Policy and tracker-record v3.
2. Replace `ticket` with a union of strings and rule objects.
3. Retain `ticket: ensure` and add an optional complete `ticketRules` matrix.

### Chosen approach

Choose option 3. Rules are legal only with ensure, are all-or-nothing, and
refine binding requirement before the existing provider-independent ensure
state machine runs.

### Trade-offs and risks

- `ticket: ensure` describes the enabled mechanism while
  `ticketRequirement` describes the active feature decision; summaries must
  distinguish them.
- The matrix is verbose in JSON, so setup uses named presets and previews the
  expanded effective rules.

### Verification

Parse all old policy fixtures unchanged, reject partial/unknown matrices, and
test each preset cell plus defensive-copy behavior.

## D-003: Treat optional as zero-I/O unless a ticket is referenced

Status: Accepted

### Evidence

- The user's objective is to avoid ceremony for small fixes while still using
  tickets for features and large bugs.
- Provider marker reconciliation itself requires authentication and network
  access, which would make an optional no-ticket path noisy and failure-prone.
- Ticket references can be extracted and checked locally before credentials.

### Options

1. Ask whether to create a ticket for every optional change.
2. Search the provider marker for optional changes but do not create.
3. With no reference, remain local; with one reference, attach; with several,
   fail closed.

### Chosen approach

Choose option 3. This removes the redundant question and guarantees no provider
or credential access for the ordinary optional path.

### Trade-offs and risks

- An unreferenced pre-existing remote marker is not discovered for optional
  work. The user can include its ticket reference or explicitly bind it.
- Existing bindings and explicit pending binds remain eligible to synchronize.

### Verification

Use throwing authentication and transport doubles to prove zero calls for the
no-reference path, then exercise one-reference attachment and multi-reference
failure.

## D-004: Exercise production synchronization in the packaged demo

Status: Accepted

### Evidence

- A printed transcript would not prove real reconcile/create/bind behavior.
- Tracker dependencies already support deterministic injected OAuth and HTTP
  adapters.
- The clean package harness already executes a packaged integration-repair demo.

### Options

1. Add documentation-only sample output.
2. Add a unit-test-only mock scenario.
3. Ship an executable isolated demo and make the clean packed-consumer harness
   assert its structured result.

### Chosen approach

Choose option 3. The demo uses the production core with a mock adapter, never a
live provider, and must prove exactly one create and one binding.

### Trade-offs and risks

- The mock response sequence must evolve with deliberate provider-contract
  changes.
- Demo code increases package surface slightly; package inspection and smoke
  tests make that explicit.

### Verification

Run the demo directly and from the packed consumer, count operation kinds, and
fail on any unexpected request, missing binding, duplicate create, or live
network attempt.
