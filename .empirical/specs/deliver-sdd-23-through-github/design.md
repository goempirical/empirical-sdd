# Design: Deliver SDD-23 Through GitHub

## Delivery topology

Delivery uses two commits and pull requests with disjoint explicit paths.

### Source

- Branch: `bb/automate-tracker-onboarding-lifecycle-thr_t3v8caaag4`
- Paths: `CHANGELOG.md`, `README.md`, `docs/`, `package.json`, `scripts/`,
  `src/`, and `tests/`
- Commit: `feat: automate tracker lifecycle and prepare 0.24.0`
- PR: `Automate tracker onboarding and lifecycle synchronization`

This commit contains the reviewed product candidate and no `.empirical` state.
Its PR body ends with Empirical's repository/feature/source marker bound to the
exact head commit.

### Evidence

- Branch: `bb/sdd-23-0-24-0-evidence`
- Base: merged `origin/main` source commit
- Paths: `.empirical/`, including the required
  `deliver-sdd-23-through-github/delivery-source.json`
- Commit: `chore: record SDD-23 delivery evidence`
- PR: `Record SDD-23 delivery evidence`

This commit contains feature contracts, journals, immutable receipts, living
capability projections, project delivery policy, and refreshed context. Its PR
body ends with the corresponding evidence marker bound to its head commit.

## CI and merge control

GitHub currently reports neither branch protection nor a ruleset for `main`.
Therefore configured required-check filtering cannot supply a protection gate.
For each PR, read all checks without the `--required` filter and wait until the
five CI matrix jobs (Ubuntu Node 22/24/26, macOS Node 24, Windows Node 24) are
terminal and successful. Any failed/cancelled/skipped job stops delivery. Only
after this observation is the draft made ready and merged with ordinary
`gh pr merge --merge`; no `--admin`, force, or direct `main` push is permitted.

## Reconciliation

After both PRs are merged, invoke Empirical delivery with the exact plans above.
Because marker-owned PRs already exist and are merged, it performs read-only
reconciliation of their heads/merge commits, writes the digest-valid delivery
receipt, and advances the authorized feature to `delivered`. Any mismatched
marker, branch, head, base, ambiguity, or missing merge commit fails closed.

## Recovery

- Reuse a matching branch/commit/PR rather than duplicate it.
- If CI fails, leave the PR open and stop without merging.
- If source merges but evidence fails, keep the source merge and resume only
  the evidence PR after an explicit repair.
- If a process stops after both merges, Empirical rediscovers both marker-owned
  PRs and records the receipt without replaying remote mutations.
