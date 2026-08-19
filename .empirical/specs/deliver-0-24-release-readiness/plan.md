# Deliver 0.24 Release Readiness Plan

1. Reconcile the complete dirty-tree inventory into disjoint source and
   evidence path plans; verify no generated coverage or unrelated user file is
   included.
2. Reuse the prior immutable CI/review/integration receipts and run a final
   local diff, Doctor, authorization, version, and remote-absence preflight.
3. Complete implementation, verification, and review for this delivery-only
   workflow with immutable receipts tied to all acceptance criteria.
4. Replay the autonomous-delivery delta and exact candidate tree against the
   clean independent worktree at current canonical `main`.
5. Invoke Empirical delivery with stable source/evidence branches and explicit
   path lists; allow it to push, open, observe, normally merge, bind the source
   merge, and persist the delivery receipt.
6. Reconcile local terminal delivery state and inspect both PR file lists,
   checks, head/merge commits, and final remote `main` workflows.
7. Inspect tag, GitHub Release, npm version, and `latest` dist-tag without
   mutation; compute and present the exact `0.24.0` publication target for
   separate approval.
