# Deliver 0.24 Release Readiness

## Request

> Deliver the already integrated harden-0-24-release-readiness source changes and Empirical evidence through protected GitHub pull requests to main, merge only after required checks pass, reconcile durable delivery receipts, and prepare but do not execute the exact immutable empirical-sdd 0.24.0 publication target. Do not create a tag, GitHub Release, npm version or dist-tag change, and do not modify any VPS.

## Goal

Move the independently verified 0.24.0 release-hardening candidate onto the
protected `main` branch through Empirical's source-then-evidence delivery
sequence, leave a complete idempotent audit trail, and determine the one exact
main commit that could be published only after separate user approval.

## Acceptance Criteria

- [ ] [AC-1] A source pull request contains only the intended release notes,
  generated activation contracts, runtime changes, and regression tests; it is
  merged normally into `main` without force-push or direct protected-branch
  mutation.
- [ ] [AC-2] An evidence pull request is based on the source merge, binds that
  exact merge commit, and contains the integrated living specifications,
  immutable receipts, compacted journals, and delivery state needed to audit
  the release-readiness work.
- [ ] [AC-3] Required GitHub checks are observed before each merge, and remote
  facts prove both pull requests are merged with durable commit identities.
- [ ] [AC-4] Delivery retries reuse their stable branches, commits, markers,
  and pull requests and cannot silently create duplicate delivery artifacts.
- [ ] [AC-5] The standing authorization is bounded to repository delivery on
  `main`; it does not authorize a tag, GitHub Release, npm publication,
  dist-tag change, credential export, or VPS mutation.
- [ ] [AC-6] After both merges, the final remote `main` commit passes the
  repository CI workflow and remains a consistent `empirical-sdd 0.24.0`
  candidate.
- [ ] [AC-7] Read-only release inspection confirms whether `v0.24.0`, the
  GitHub Release, npm `0.24.0`, and the `latest` dist-tag exist, and produces
  the exact commit/version/dist-tag authorization target without executing it.

## Scope

- Protected GitHub delivery of the already integrated release-readiness source
  and evidence changes.
- Durable source-merge binding, delivery receipt, and terminal journal
  reconciliation.
- Post-merge CI/status inspection and exact immutable publication preflight.

## Non-goals

- Any new tracker, Doctor, delivery-runner, or package behavior beyond the
  already integrated candidate.
- Creating or replacing a Git tag, GitHub Release, npm version, or dist-tag.
- Installing or updating Empirical on any local or remote host.
- Broadening the sanitized command environment or exposing credentials.

## Verification

- Empirical's delivery operation observes, creates, or resumes the two planned
  pull requests and records exact command and remote-fact digests.
- GitHub PR metadata and checks are re-read after merge; the remote `main` head
  is resolved independently.
- CI is inspected on both PR heads and the final merged main commit.
- Publication inspection is read-only and its result is compared with package
  metadata before an exact approval request is presented.

## Capability Deltas

- `autonomous-delivery`: a delivery-only release-preparation authorization may
  merge an integrated candidate and compute its exact publication target while
  publication and deployment remain separately gated.
