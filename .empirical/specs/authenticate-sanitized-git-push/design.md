# Authenticate Sanitized Git Push Design

## Context

The release-readiness source/evidence delivery proved direct `gh` commands can
use the sanitized runtime after receiving `GH_CONFIG_DIR`, but HTTPS
`git push` still failed before creating a remote branch. The Git subprocess had
neither a credential helper nor access to the host `gh` configuration. The
temporary delivery wrapper proved the required boundary with a dry run and the
two protected PRs, but is not a product solution.

## Runtime design

Add one command-aware environment builder used by the existing built-in
delivery runner:

- Direct `gh` argv receives only `GH_CONFIG_DIR`, preserving the current fix.
- Exact `git push` argv receives `GH_CONFIG_DIR`, `GIT_TERMINAL_PROMPT=0`, and
  two in-memory Git configuration entries:
  1. an empty `credential.https://github.com.helper` entry to reset inherited
     helper selection for that URL; and
  2. a constant `!gh auth git-credential` helper entry.
- Every other argv receives no additional environment.

Git's documented `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_n`, and
`GIT_CONFIG_VALUE_n` process environment supplies configuration without writing
`.git/config`, a global file, or a system file. Git invokes the constant `gh`
credential helper as a descendant; `GH_CONFIG_DIR` lets that process locate the
host-owned login. The credential protocol passes the token directly between Git
and `gh`; Empirical never requests, captures, logs, or stores it.

The outer runtime remains `shell: false` with exact argv. No user-controlled
text enters the constant helper command. Runtime results continue to retain
only sorted environment key names, never values.

## Failure behavior

With an absent or unusable login, the helper cannot answer and `git push`
returns its ordinary bounded nonzero result. `GIT_TERMINAL_PROMPT=0` prevents a
terminal prompt. No fallback to `HOME`, `GH_TOKEN`, `GITHUB_TOKEN`, askpass, or
persistent Git configuration is available.

## Verification

- Unit-test exact environment selection for direct `gh`, exact `git push`, Git
  inspection/fetch, npm, and arbitrary argv.
- Assert helper values are constant, token variables and `HOME` are absent,
  and returned runtime/publication state contains neither the config path nor
  helper value.
- Simulate unavailable authentication with an injected process adapter and
  require truthful failure.
- Execute a live push dry run with an otherwise empty environment and confirm
  the named remote ref remains absent before and after.
- Run focused tests, full release CI, and independent integration before the
  fix uses its own built-in delivery path.
