# Authenticate Sanitized Git Push Plan

1. Add a pure command-aware environment selector beside the existing GitHub CLI
   locator and use it in the built-in delivery/publication runner.
2. For exact `git push`, supply ordered process-only Git config entries selecting
   `gh auth git-credential`, the gh config locator, and noninteractive mode;
   return no additions for other commands.
3. Extend delivery tests for direct gh, authenticated push, non-push isolation,
   absent login, environment-key-only receipts, and unchanged injected runners.
4. Run focused delivery/runtime tests, a live sanitized `git push --dry-run`
   with before/after remote-ref inspection, Doctor, and the complete clean CI.
5. Review every security and compatibility criterion and record immutable test
   and review evidence.
6. Integrate the autonomous-delivery delta against a clean independent worktree
   at final canonical `main` and rerun Policy v2 CI there.
7. Deliver source and evidence through stable protected PR branches using the
   built-in runner itself, inspect final-main checks, and prepare the exact
   still-unpublished 0.24.0 target.
