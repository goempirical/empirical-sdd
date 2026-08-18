# Plan: Deliver SDD-23 Through GitHub

## 1. Reconcile and verify scope

- [ ] Fetch `origin/main`; confirm it still equals the reviewed integration base
  and no matching source/evidence PR or remote branch conflicts exist.
- [ ] Refresh `0.24.0` context after delivery-policy/feature-state changes.
- [ ] Run formal CI and record test/review evidence for the delivery revision.
- [ ] Inspect the complete source/evidence path sets and ensure no secret value
  or unrelated user change is included.

## 2. Source pull request

- [ ] Stage and commit only `CHANGELOG.md`, `README.md`, `docs/`,
  `package.json`, `scripts/`, `src/`, and `tests/` on the current source branch.
- [ ] Confirm the staged/committed name set contains no `.empirical` path.
- [ ] Push without force and open/reuse one PR to `main` whose body contains the
  exact Empirical source marker bound to the head commit.
- [ ] Wait for all five CI jobs; on any non-success stop with the PR unmerged.
- [ ] Mark ready and merge normally; fetch and record the source merge commit.

## 3. Evidence pull request

- [ ] Switch/create `bb/sdd-23-0-24-0-evidence` from merged `origin/main` while
  preserving only the pending `.empirical/` working-tree changes.
- [ ] Create the digest-bound source-merge evidence file using the merged source
  commit and current integration receipt.
- [ ] Stage and commit only `.empirical/`; confirm no product-source delta.
- [ ] Push without force and open/reuse one evidence PR with the exact Empirical
  marker bound to its head commit.
- [ ] Wait for all five CI jobs; on any non-success stop with the PR unmerged.
- [ ] Mark ready and merge normally; fetch and record the evidence merge commit.

## 4. Empirical reconciliation

- [ ] Invoke delivery with the approved exact source/evidence plans so it finds
  the already merged marker-owned PRs and performs no new remote mutation.
- [ ] Validate the delivery receipt digest, PR facts, head/merge commits, final
  `origin/main`, and local `delivered` completion.
- [ ] Confirm no Git tag, GitHub Release, npm version, or dist-tag was created.
