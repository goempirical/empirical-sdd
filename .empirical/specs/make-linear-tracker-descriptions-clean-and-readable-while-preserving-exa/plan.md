# Plan

1. Add Linear-specific readable projection and recovery renderers, strict marker
   classifiers, and exact legacy-to-Markdown migration helpers in `src/tracking.ts`.
2. Route Linear create, attach recovery, reconciliation, and synchronization
   through the new helpers without changing GitHub or Jira behavior.
3. Extend `tests/tracking.test.ts` for readable source, legacy migration, preserved
   human content and digest, ambiguity failures, and no-second-create recovery.
4. Run TypeScript, focused tests, diff checks, and the complete CI gate; capture
   immutable verification evidence.
5. Request a fresh Linear credential through BB's secure secret flow, attach and
   synchronize SDD-5, inspect only safe presentation facts, and remove all
   temporary credential and harness files.
6. Refresh repository context, review the final diff, integrate the capability
   delta against an independent worktree, commit, push, and verify PR #13 checks.
