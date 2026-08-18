# Decisions: Tracker Onboarding and Rich Lifecycle Synchronization

## D-001: Add Policy v2 while normalizing v1 in memory

Status: Accepted

### Evidence

- Current `tracker.json` is a strict Policy v1 sidecar and participates in
  target and projection digests.
- Existing repositories and tests depend on v1 parsing, explicit binding, and
  durable dispatched-create recovery.
- Ticket behavior and progress visibility are new persistent semantics that
  cannot be inferred safely from the existing file.

### Options

1. Rewrite every v1 policy during Init repair.
2. Change v1 semantics implicitly based on new defaults.
3. Accept v1 and v2, normalize v1 conservatively in memory, and write v2 only
   after explicit preview and apply.

### Chosen approach

Choose option 3. V1 retains manual binding and legacy projection behavior;
ordinary repair neither rewrites it nor contacts a provider.

### Trade-offs and risks

Runtime branches must handle two durable versions until v1 support is retired,
but the compatibility boundary is explicit and existing repositories do not
gain remote effects silently.

### Verification

Load v1 policy/binding/pending fixtures, prove byte preservation during repair,
exercise existing behavior, then explicitly apply and read back v2.

## D-002: Use stateless discovery plus revalidated preview/application

Status: Accepted

### Evidence

- Provider target catalogs and permissions can change between setup steps.
- Persisting discovery responses risks stale IDs and accidental authorization
  material while the required policy is intentionally secret-free.
- The current injectable bounded transport already supports deterministic
  provider tests without storing remote catalogs.

### Options

1. Persist a long-lived discovery session and trust it during apply.
2. Require users to copy identifiers into a v2 policy.
3. Return a provider-neutral discovery result, preview from it, and repeat
   access/selection validation immediately before atomic apply.

### Chosen approach

Choose option 3. Discovery is read-only and ephemeral; apply revalidates the
selected canonical identities and complete mapping.

### Trade-offs and risks

Apply costs an additional bounded provider read and can reveal newly changed
metadata, but it cannot save a policy whose access proof is stale or forged.

### Verification

Simulate permission removal and metadata drift between preview and apply; assert
the previous tracker policy bytes remain unchanged.

## D-003: Generalize pending synchronization into an acknowledged effect ledger

Status: Accepted

### Evidence

- Current pending records durably separate prepared and dispatched create intent,
  preventing automatic duplicate creates after a lost response.
- Milestone comments and artifact uploads introduce multiple independently
  successful remote effects in one local revision.
- A single synchronized boolean cannot distinguish a successful comment from a
  failed upload and would duplicate one of them on retry.

### Options

1. Treat the entire projection as one remote transaction.
2. Rely only on provider-side idempotency headers without local receipts.
3. Persist deterministic effect keys and atomically acknowledge each completed
   bind, transition, comment, and artifact effect.

### Chosen approach

Choose option 3, retaining the existing create dispatch flag as a stricter
sub-state within the ledger.

### Trade-offs and risks

Pending schema and recovery logic become richer, but partial failures are
reconstructable and provider-specific idempotency is no longer the sole safety
control.

### Verification

Interrupt after every effect boundary and retry from disk; assert one ticket,
one milestone per feature/revision/receipt digest, and one artifact per artifact
effect key.

## D-004: Publish lifecycle history as comments and gate evidence by receipts

Status: Accepted

### Evidence

- Current Linear synchronization replaces an Empirical-owned description block,
  which makes the latest state readable but does not provide milestone history.
- User-authored issue descriptions must remain outside Empirical ownership.
- Evidence receipts already bind repository-contained artifacts and provenance,
  providing a stronger approval boundary than arbitrary configured paths.

### Options

1. Continue rewriting a managed description block and append artifact paths.
2. Rewrite the full provider description from local state.
3. Preserve descriptions, publish idempotent comments/activities, and project
   only receipt-approved artifacts that pass containment and media bounds.

### Chosen approach

Choose option 3. Legacy markers remain parseable for compatibility, while all
new progress is append-only provider activity.

### Trade-offs and risks

Provider issue history becomes more verbose at `revisions` visibility, and
binary upload capability differs by provider. Visibility filters and explicit
adapter capabilities keep this predictable; safe links or bounded omissions are
used when upload is unavailable.

### Verification

Assert Linear descriptions are byte-for-byte unchanged, visibility creates the
expected activity count, and unsafe/unapproved/symlink-escaping artifacts never
reach the transport.
