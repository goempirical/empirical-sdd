# Decisions: Release 0 26 0

Record concise, externally reviewable evidence and choices here. Do not store
private chain-of-thought, prompts, credentials, secrets, or scratchpad text.

## D-001: Release the feature as alpha MINOR 0.26.0

Status: Accepted

### Evidence

- The current public version is `0.25.0`; npm `latest`, the remote tag, and the
  GitHub release all converge on that version.
- The completed work adds public question-mode configuration, Tracker Policy v2
  rules, action/status fields, generated guidance, and a packaged demo.
- The documented alpha policy assigns additive or breaking public workflow
  changes to MINOR releases and keeps schema versioning independent.

### Options

1. Publish a PATCH `0.25.1` and treat the additions as corrections.
2. Publish MINOR `0.26.0` while preserving Schema 5 compatibility.
3. Delay all changes for a later combined release.

### Chosen approach

Choose `0.26.0`. Align the canonical runtime version and every derivative
surface, retain Schema 5, and explicitly state that existing repositories need
no state migration.

### Trade-offs and risks

The MINOR makes the public change visible and follows the repository's alpha
contract. It requires coordinated updates across runtime, tests, docs, and the
changelog; the consistency and clean-consumer gates mitigate drift.

### Verification

`bun run ci`, direct version/help assertions, the dated changelog and compare
links, and `npm pack --dry-run --json` must all agree on `0.26.0` and Schema 5.

## D-002: Bind publication to the protected evidence merge

Status: Accepted

### Evidence

- Repository Policy v2 targets protected `main` delivery.
- Empirical delivery produces a source merge followed by a separate evidence
  merge and records both SHAs.
- Publication validation rejects a commit other than the delivery receipt's
  evidence merge.

### Options

1. Publish the local feature commit directly.
2. Publish the source PR merge before evidence is merged.
3. Publish only the final evidence merge after both protected PRs pass.

### Chosen approach

Use option 3. The evidence merge is the exact commit for the annotated tag,
GitHub release, and publication authorization.

### Trade-offs and risks

The additional PR costs time but preserves independently reviewable evidence and
prevents an unrecorded local candidate from becoming the package source.

### Verification

The delivery receipt must identify both merged PRs, the release SHA must equal
its evidence merge SHA, and `git merge-base --is-ancestor` must confirm that SHA
is on remote `main`.

## D-003: Converge npm through the trusted GitHub release workflow

Status: Accepted

### Evidence

- `.github/workflows/publish.yml` publishes non-prerelease GitHub releases with
  npm trusted publishing and provenance-capable OIDC, without a long-lived npm
  token.
- Publication can observe partial remote state and safely retry an identical
  immutable request.

### Options

1. Handle a local npm token and publish directly.
2. Create the authorized immutable GitHub release and let its trusted workflow
   publish, then converge the identical Empirical operation.
3. Change the release workflow as part of this version.

### Chosen approach

Use option 2. Keep credentials in trusted host stores, monitor the release's
publish workflow, and retry only the same authorization if hosted publication
finishes after the initial convergence call.

### Trade-offs and risks

Hosted publication is asynchronous and can leave a temporary partial state.
The tag and release remain immutable; bounded observation and identical retry
complete the receipt without replacement.

### Verification

The publish workflow must succeed for `v0.26.0`; postflight inspection must show
the tag/release on the evidence merge and npm version plus `latest` on `0.26.0`.
