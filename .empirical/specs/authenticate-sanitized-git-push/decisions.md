# Authenticate Sanitized Git Push Decisions

## D-001: Use process-only Git configuration for authenticated pushes

Status: Accepted

### Evidence

- A sanitized HTTPS push failed with no credential helper even though direct
  `gh` authentication succeeded through `GH_CONFIG_DIR`.
- The same push with process-only Git config selecting
  `gh auth git-credential` passed `--dry-run` and created no ref.
- Git supports command-scoped configuration through `GIT_CONFIG_COUNT` and
  indexed key/value variables.

### Options

1. Inherit `HOME` for all Git commands.
2. Read `gh auth token` and pass a token or credential-bearing URL.
3. Run `gh auth setup-git` and modify persistent configuration.
4. Supply a constant gh credential helper through process-only Git config for
   exact pushes.

### Chosen approach

Choose option 4. Git and `gh` exchange the credential through their native
protocol, while Empirical supplies only non-secret locator and configuration
metadata and writes no configuration.

### Trade-offs and risks

- Git credential helpers use Git's documented helper execution mechanism; the
  helper command must therefore remain a product-owned constant with no user
  interpolation.
- This path is specific to GitHub HTTPS delivery and intentionally does not
  discover or support arbitrary credential providers.

### Verification

Inspect exact child environments, prove persistent config bytes are unchanged,
exercise success with a live dry run, and exercise missing login through an
injected adapter.

## D-002: Bound helper selection and noninteractive failure

Status: Accepted

### Evidence

- Git permits multiple helper entries; an empty entry resets earlier helpers.
- A delivery process must fail deterministically rather than invoking a host
  prompt or unrelated helper when `gh` cannot authenticate.

### Options

1. Append the gh helper after any existing helper.
2. Reset the GitHub HTTPS helper list, select only gh, and disable prompting.

### Chosen approach

Choose option 2 for exact `git push` only. This makes the credential source
bounded and ensures missing authentication is a truthful automation failure.

### Trade-offs and risks

Hosts that intentionally use another helper for GitHub will not have it used by
Empirical's built-in push. They can authenticate `gh` explicitly or inject a
custom runner; Empirical will not guess between stores.

### Verification

Assert the two ordered config entries and `GIT_TERMINAL_PROMPT=0`, and prove
non-push command environments are unchanged.
