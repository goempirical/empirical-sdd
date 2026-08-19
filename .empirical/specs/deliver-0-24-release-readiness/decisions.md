# Deliver 0.24 Release Readiness Decisions

## D-001: Deliver source and evidence as separate protected changes

Status: Accepted

### Evidence

- The code/test/managed-skill changes are independently reviewable from the
  local workflow journals, capability projections, and receipts.
- The evidence binding can name the source merge only after GitHub confirms it.

### Options

1. Put all files in one pull request.
2. Commit directly to `main`.
3. Use the policy-defined source PR followed by an evidence PR.

### Chosen approach

Choose option 3. It preserves protected-branch review and lets evidence bind the
actual source merge rather than a predicted identity.

### Trade-offs and risks

There are two remote merges to observe, but each has a smaller intentional
scope and a durable idempotency marker.

### Verification

Compare each PR file list with its explicit path plan and confirm both remote
merge commits before accepting the delivery receipt.

## D-002: Use a delivery-only standing authorization

Status: Accepted

### Evidence

- The repair feature correctly terminated at integrated because it had no
  standing delivery authorization.
- Empirical authorization ceilings intentionally exclude publication from
  ordinary YOLO and bind the target branch and repository identity.

### Options

1. Mutate the completed repair feature's historical authorization.
2. Deliver outside Empirical and reconstruct evidence later.
3. Start an explicit delivery-only run capped at `delivered` on `main`.

### Chosen approach

Choose option 3. It preserves historical truth, supplies the required durable
authorization before remote mutation, and cannot invoke publication.

### Trade-offs and risks

The delivery run adds its own small workflow history, but makes the authority
boundary and completion level auditable.

### Verification

Verify the authorization digest, ceiling, target branch, and repository identity
before delivery; prove no publication or VPS receipt exists afterward.

## D-003: Prepare the release target by read-only convergence inspection

Status: Accepted

### Evidence

- The exact publishable commit does not exist until the evidence PR is merged.
- Tags, GitHub Releases, npm versions, and dist-tags are immutable or externally
  visible state that must be inspected before planning publication.

### Options

1. Pre-authorize the current local commit.
2. Publish immediately after the evidence merge.
3. Resolve final `main`, inspect all release surfaces, and request exact approval.

### Chosen approach

Choose option 3. Publication planning is based on observed final state and the
user can approve one immutable commit/version/dist-tag tuple.

### Trade-offs and risks

This introduces an intentional approval pause after delivery; it prevents a
stale or guessed commit from being released.

### Verification

Cross-check remote `main`, package metadata, tag, release, registry version, and
dist-tag, then compute the exact request digest without executing mutations.
