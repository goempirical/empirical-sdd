# Decisions

## D-001: Derive the consult set instead of persisting it

Status: Accepted

### Evidence

- `WorkflowState` is Schema 5 and the consistency gate asserts
  `SCHEMA_VERSION === 5`; adding a field obliges a migration path.
- `routeRequest` is already pure and deterministic over request text.
- Acceptance criteria already expose a `ui` flag parsed from `[UI]` tags.

### Options

1. Persist a `consults` array on `WorkflowState`.
2. Add `consults` to the digest-frozen impact manifest.
3. Derive the set at read time from routed risk floor and parsed criteria.

### Chosen approach

Option 3. Both inputs are available wherever the set is needed, so derivation is
free, forgery-proof, and migration-free. Option 1 costs a schema bump and can
drift from the spec it describes; option 2 freezes the set at Specify, before
`[UI]` criteria may still be added.

### Trade-offs and risks

Derivation recomputes on every read, and a later change to trigger signals
retroactively changes which advisories a in-flight feature owes. That is the
correct behavior here — the artifacts stay authoritative — and the cost is a
regex pass already performed during routing.

### Verification

Assert identical consult sets across repeated evaluation, assert caller-supplied
specialist names are ignored, and assert an existing Schema-5 repository opens
with no migration prompt.

## D-002: Consults are advisory by default, blocking only in-domain

Status: Accepted

### Evidence

- The starter's specialist protocol returns advisories folded into an existing
  artifact and blocks only on a critical or high finding in its own domain.
- The repo's own severity discipline already distinguishes hard gates from
  reported findings.

### Options

1. Every consult finding blocks its gate.
2. Consults never block; they only annotate.
3. Blocking requires a `blocking` verdict plus a critical or high finding inside
   the specialist's declared domain.

### Chosen approach

Option 3. Option 1 turns a consult into a veto and makes tagging expensive
enough that people avoid it. Option 2 makes a security consult decorative, which
defeats the point of the highest-value specialist.

### Trade-offs and risks

A specialist can under-report to avoid blocking. That is mitigated by the
advisory being durable reviewable evidence rather than a transient verdict, so an
under-reported advisory is visible in review.

### Verification

Assert a blocking in-domain finding stops the gate and names the finding, and
assert a high finding outside the declared domain proceeds while remaining
recorded.

## D-003: Assert slice narrowness rather than documenting it

Status: Accepted

### Evidence

- The stated reason for removing generalist roles was token cost and context
  fragmentation across handoffs.
- A consult that received the full phase context would reproduce that cost while
  claiming not to.

### Options

1. Document the narrowness convention in the registry comments.
2. Assert at test time that each returned slice is a strict subset of the phase
   packet's required context.

### Chosen approach

Option 2. The property that justifies the whole design is worth a test, not a
comment; a comment cannot fail.

### Trade-offs and risks

A future specialist whose domain genuinely spans the whole specification could
not be expressed. That is an acceptable constraint, and arguably a signal that
such a thing is a phase rather than a consult.

### Verification

Compare each returned context slice against the current phase packet's required
context and assert strict subset.

## D-004: Anchor the [UI] criterion tag while adding consults

Status: Accepted

### Evidence

- `parseCriteria` flagged any criterion whose text merely *mentions* `[UI]`,
  because the test was `/\[UI\]/i` against the whole criterion.
- This specification's own AC-3 describes the UI trigger and therefore became a
  false UI criterion, which required browser and screenshot evidence at Verify
  for a change with no interface at all.
- The documented convention places the tag immediately after the criterion id.

### Options

1. Reword AC-3 to avoid the token.
2. Leave the parser and accept the false positive.
3. Anchor the tag to the start of the criterion text.

### Chosen approach

Option 3. Option 1 is unavailable: the specification digest is frozen at Specify
approval, and this repository is correct to refuse a post-approval edit. Option 2
would leave this feature deriving a specialist from a false signal, which is the
exact "over-broad trigger" risk this specification names.

### Trade-offs and risks

This is a behavioral change to criterion parsing carried inside another feature's
change set, and it has no capability delta of its own because the deltas are
digest-frozen at Specify approval. It is deliberately minimal and strictly
narrowing: a criterion tagged `[UI]` in the documented position behaves exactly
as before, and only prose mentions stop being treated as an interface surface.
If a reviewer prefers it separated, it is a two-line revert plus its own feature.

### Verification

Assert a tagged criterion is still detected, assert a criterion that mentions the
token in prose is not, and confirm the existing suite passes unchanged.
