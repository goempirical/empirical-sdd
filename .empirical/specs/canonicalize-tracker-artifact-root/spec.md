# Canonicalize Tracker Artifact Root

## Request

> Fix the macOS tracker artifact containment false positive by resolving receipt artifact paths from the canonical repository root, add a deterministic symlinked-root regression test, rerun focused and full CI, then fast-forward the existing source PR branch and update its Empirical marker without force.

## Goal

Allow receipt-approved evidence that is genuinely contained in the repository
to project from checkouts whose lexical root has a different canonical path,
while preserving the existing fail-closed artifact boundary and idempotent
provider recovery.

## Acceptance Criteria

- [ ] [AC-1] A receipt-approved regular file beneath a repository reached
  through a symbolic-link alias remains eligible for tracker projection rather
  than being rejected as an apparent repository escape.
- [ ] [AC-2] Missing, secret-like, direct traversal, and symbolic-link escape
  artifacts still fail before any provider request or artifact effect.
- [ ] [AC-3] Jira attachment projection still records durable acknowledgements
  and recovers a lost upload response without uploading the same artifact
  twice.
- [ ] [AC-4] The focused tracker tests and complete repository CI pass, then the
  existing PR branch advances by fast-forward only and its exact Empirical
  marker identifies the new source commit.

## Scope

- Canonical repository-root use during approved tracker artifact resolution.
- A deterministic regression fixture whose lexical and canonical repository
  roots differ.
- Focused and complete verification of the tracker projection behavior.
- Fast-forward delivery of the fix to the existing source PR.

## Non-goals

- Changing artifact receipt, media-type, size, digest, or secret-path policy.
- Relaxing symbolic-link escape protection or provider target validation.
- Changing upload, durable-link, milestone, or retry protocols.
- Publishing version 0.24.0, creating a release, or deploying to VPS hosts.

## Verification

- Run the focused tracker test file, including the aliased-root regression and
  existing unsafe-artifact and Jira lost-response scenarios.
- Run `bun run ci` from the isolated fix worktree.
- Confirm all required GitHub Actions jobs on PR #24 pass at the fast-forwarded
  head before readiness or merge.

## Capability Deltas

- `deltas/external-ticket-tracking.md` adds the canonical-root eligibility
  guarantee without weakening repository containment.
