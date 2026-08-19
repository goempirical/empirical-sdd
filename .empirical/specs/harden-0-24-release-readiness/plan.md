# Harden 0.24 Release Readiness Plan

1. Add behavioral/non-behavioral persisted integration receipt types and a
   class-aware verifier in `src/coordination.ts`; route Doctor through it.
2. Add Doctor regression fixtures for a valid non-behavioral receipt, a mixed
   receipt, digest tampering, and read-only preservation.
3. Add a pure GitHub CLI configuration-directory resolver in `src/delivery.ts`
   and pass its `GH_CONFIG_DIR` result only to built-in `gh` invocations.
4. Add delivery tests for documented locator precedence, exact process
   environment, omission from Git/npm commands and retained receipts, and
   truthful missing-auth failure.
5. Run typecheck and focused Doctor/delivery/runtime suites; resolve every
   failure without weakening receipt or credential boundaries.
6. Invoke ownership-aware repository Init repair with tracker preservation,
   verify only expected marker-owned integration updates, repeat it to prove
   byte stability, and run Doctor.
7. Run `bun run ci`, create immutable test/review evidence for all eight
   criteria, and complete Verify and Review.
8. Replay the three capability deltas into an independent target, run the full
   verification command there, and persist the integration receipt.
9. Deliver source and evidence changes through protected GitHub pull requests,
   wait for cross-platform CI and exact merges, then inspect the immutable
   `0.24.0` publication state.
10. Present the exact package/version/dist-tag/final commit and require separate
    publication authorization before creating a tag, GitHub Release, npm
    version, dist-tag, or changing any VPS.
