# Decisions: Release 0 25 0

Record concise, externally reviewable evidence and choices here. Do not store
private chain-of-thought, prompts, credentials, secrets, or scratchpad text.

## D-001: Bind publication to a fresh post-fix evidence merge

Status: Accepted

### Evidence

- The original evidence merge `9314ac4` preceded the Windows correction.
- PR #34 merged the correction as `97a2aadb` after all five CI jobs passed.
- Empirical publication requires the publication commit to equal a durable
  evidence merge commit.

### Options

1. Publish from `9314ac4`, omitting the Windows correction.
2. Tag the latest `main` manually without fresh Empirical evidence.
3. Add the correction release note and deliver a fresh source/evidence pair
   before exact publication.

### Chosen approach

Choose option 3. It keeps the release source, supported-platform evidence,
living package-distribution contract, and immutable publication commit aligned.

### Trade-offs and risks

This adds two small protected PRs and another CI cycle. The cost is justified by
preventing a release tag from pointing at known Windows-failing source. Remote
artifact conflicts and trusted-publishing delays remain fail-closed and
idempotently retryable.

### Verification

The final source PR matrix passes on all five jobs; the evidence PR merges after
integration; the annotated tag and GitHub release target that evidence merge;
and npm `0.25.0` plus `latest` converge through trusted publishing.
