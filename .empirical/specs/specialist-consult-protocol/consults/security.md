# Security consult — specialist consult protocol

- Specialist: security
- Verdict: advisory

## Threat model

The change adds one derived requirement, one read-only operation, and one parsed
artifact. It introduces no network call, no subprocess, no credential handling,
and no new authorization boundary. The surfaces worth attacking are therefore:

1. **The derivation**, if an attacker can suppress a required consult.
2. **The advisory read**, because it builds a filesystem path from state.
3. **The advisory parser**, because it consumes repository-controlled text.
4. **The gate**, if a malformed or hostile advisory can be made to pass.

## Findings

### Finding 1

- Severity: medium
- Category: untrusted-input
- Location: src/core.ts (evaluateFeatureConsults readAdvisory)
- Recommendation: Route the advisory read through the repository's own feature-path containment guard instead of a raw join, and reject any resolved path outside the feature's consults directory. Fixed in this change.

The first implementation resolved the advisory with a bare `join(root, path)`,
unlike every other feature-scoped read in `storage.ts`, which first calls
`assertFeaturePathSafe` and therefore refuses symlinked feature storage. The
feature id is slug-validated when state is loaded, so this was defense in depth
rather than a live traversal, but the asymmetry was real: a symlinked
`consults/` directory, or any future path that reaches this read with a less
validated feature name, would have been followed. Now the read asserts feature
path safety and requires the resolved path to stay inside
`<spec-dir>/consults`, returning null otherwise — which the gate treats as a
missing advisory and fails closed.

### Finding 2

- Severity: medium
- Category: authorization
- Location: src/specialists.ts (evaluateConsults)
- Recommendation: Accept that the gate is satisfiable by the reviewed party, and rely on the advisory being durable reviewable evidence rather than proof; do not describe a consult as an independent control.

The advisory is written by the same agent whose work is being gated. Nothing
prevents it from recording a no-findings verdict it did not earn. This is
inherent to an in-process consult and is the same trust model as every other
agent-authored artifact in the repository, so it is not a regression — but it
means a consult must not be presented as an independent security control. Its
value is that under-reporting becomes visible in review, because the advisory is
committed alongside the diff. The independent control is the reviewer, and SDD-16
is where genuine independence is being addressed.

### Finding 3

- Severity: low
- Category: secrets
- Location: .empirical/specs/<feature>/consults/<specialist>.md
- Recommendation: Keep the no-credentials rule stated in the delta, and consider a future scan of advisory content for high-entropy strings before it is committed.

Advisories are committed repository content and describe security weaknesses in
concrete terms. A careless advisory could paste a token, a live payload, or an
exploit path. The specification already forbids persisting credentials, and the
parser stores only bounded structured fields, but nothing mechanically enforces
it today.

### Finding 4

- Severity: low
- Category: untrusted-input
- Location: src/specialists.ts (parseConsultAdvisory)
- Recommendation: Consider bounding advisory size before parsing, consistent with the bounded-output discipline used for command execution.

The parser reads the whole advisory into memory and splits it into lines. Parsing
is linear with no backtracking regex over attacker-controlled text, so there is
no ReDoS, but there is no size ceiling either. The file is repository-controlled
and reaching it already requires write access to the working tree, so the
practical risk is low.

## Checked and clear

- **Forgery of the required set.** `deriveConsults` accepts only a risk floor and
  parsed criteria; there is no parameter through which a caller could assert or
  suppress a specialist. Covered by test.
- **Fail-closed behavior.** A missing, empty, malformed, or wrong-specialist
  advisory is treated as missing and stops the gate. It is never treated as a
  pass. Covered by six parser tests and four evaluation tests.
- **Blocking scope.** A specialist cannot veto outside its declared domain, so a
  compromised or overzealous consult cannot block unrelated work. Covered by test.
- **Injection.** No SQL, shell, or template evaluation is introduced. The one
  dynamically constructed regex uses a fixed label from a closed set, never
  advisory content.
- **State integrity.** The consult path performs no write, creates no revision,
  and mutates no workflow state, so it cannot corrupt the journal or advance a
  gate as a side effect.
