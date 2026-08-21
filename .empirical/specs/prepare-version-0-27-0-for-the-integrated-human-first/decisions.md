# Decisions: Prepare and Publish 0.27.0

Record concise, externally reviewable evidence and choices here. Do not store
private chain-of-thought, prompts, credentials, secrets, or scratchpad text.

## D-001: Release the tracker enhancement as alpha MINOR 0.27.0

Status: Accepted

### Evidence

- The current public version, GitHub release, and npm `latest` are `0.26.1`.
- Human-first tracker comments add observable GitHub, Linear, and Jira behavior
  while preserving the durable Schema 5 and Tracker Policy v1/v2 formats.
- The repository's alpha policy assigns additive public workflow behavior to a
  MINOR release and keeps schema changes independent.

### Options

1. Publish PATCH `0.26.2` as a correction.
2. Publish MINOR `0.27.0` while retaining Schema 5 compatibility.
3. Defer the integrated behavior to an unspecified combined release.

### Chosen approach

Use `0.27.0`. Align every version surface, retain Schema 5, and state explicitly
that existing repositories and Tracker Policy v1/v2 configurations require no
migration.

### Trade-offs and risks

The MINOR accurately signals additive behavior but requires coordinated runtime,
package, documentation, test, and changelog updates. Consistency and
clean-consumer gates reject drift.

### Verification

`bun run ci`, direct version assertions, changelog links, versioning text, and
`npm pack --dry-run --json` must all agree on `0.27.0` and Schema 5.

## D-002: Incorporate current upstream main before release delivery

Status: Accepted

### Evidence

- This worktree began at `dc0df32`, the `v0.26.1` tag.
- Protected upstream `main` is now `f672226` and adds the `0.26.1`
  release-preparation merge in versioning and lifecycle-test paths.
- A PR that does not contain current upstream could conflict or omit accepted
  evidence changes.

### Options

1. Open the PR from the stale base and let GitHub resolve it.
2. Incorporate current upstream without force, then apply `0.27.0` changes.
3. Replace the feature branch with upstream and reconstruct the work.

### Chosen approach

Use option 2. Preserve the verified feature work, incorporate upstream through
ordinary Git ancestry, update the overlapping release surfaces to `0.27.0`, and
verify the resulting scoped diff.

### Trade-offs and risks

Reconciliation adds ancestry to the branch and may expose conflicts, but it
makes the release candidate explicit and reviewable. Any conflict is resolved
from repository evidence; no stash, force, or destructive reset is allowed.

### Verification

Confirm upstream `main` is an ancestor of the delivered head, inspect all staged
paths, and run independent integration against a clean current-main checkout.

## D-003: Use Empirical's protected source and evidence PR sequence

Status: Accepted

### Evidence

- Repository delivery policy targets protected `main`.
- The living autonomous-delivery contract requires a source PR followed by an
  immutable evidence PR, normal merges, and observable check results.
- Publication may bind only the final evidence merge commit.

### Options

1. Push and merge one source PR manually, then publish its merge commit.
2. Use the required source/evidence PR pair and bind publication to the second
   merge.
3. Bypass branch protection with an administrative direct push.

### Chosen approach

Use option 2. Both PRs are non-draft, checks must pass, and merges remain normal
protected GitHub operations.

### Trade-offs and risks

The second PR adds latency but keeps verification evidence independently
reviewable and gives publication one auditable protected commit.

### Verification

The delivery receipt must identify both PR URLs, both merge SHAs, successful
required checks, and the final evidence merge on upstream `main`.

## D-004: Publish npm through the trusted GitHub release workflow

Status: Accepted

### Evidence

- `.github/workflows/publish.yml` publishes non-prerelease GitHub releases using
  npm trusted publishing and OIDC.
- `v0.27.0` and `empirical-sdd@0.27.0` are currently absent; npm `latest` is
  `0.26.1`.
- Publication logic rejects conflicting immutable surfaces.

### Options

1. Use a local npm token and run `npm publish` directly.
2. Create the exact authorized GitHub release and monitor its trusted workflow.
3. Modify the release workflow as part of this candidate.

### Chosen approach

Use option 2. Keep credentials in GitHub's trusted environment, bind the release
to the final evidence merge, and converge only the identical authorized request.

### Trade-offs and risks

Hosted publication is asynchronous and may temporarily leave tag/release state
ahead of npm. Bounded observation and an identical retry handle that without
replacement.

### Verification

The publish workflow must succeed for `v0.27.0`; postflight inspection must show
the tag/release on the evidence merge and npm version plus `latest` on `0.27.0`.
