# Plan: Release SDD-23 and Roll Out to VPS Hosts

## 1. Establish and prepare the candidate

- [ ] Reconcile `origin/main`, the current branch, tags, GitHub releases, npm
  versions/dist-tags, and the complete dirty diff; stop on unexpected remote or
  unrelated local changes.
- [ ] Locate every canonical or asserted `0.23.1` surface and advance the
  product candidate to `0.24.0` without changing Schema 5.
- [ ] Consolidate the untagged `0.23.1` changelog material and SDD-23 entries
  under dated `0.24.0`; repair compare links from `v0.23.0`.
- [ ] Refresh generated repository context and inspect the resulting diff.

## 2. Verify source and package behavior

- [ ] Run targeted version, tracker, CLI, MCP, package-export, and documentation
  tests while iterating on any release-preparation defects.
- [ ] Run formal CI with enforced line/function coverage, build, consistency,
  package-content, and MCP gates.
- [ ] Pack the candidate, inspect its bounded contents/metadata, install it into
  a temporary clean consumer, and smoke the CLI plus all supported entrypoints.
- [ ] Record immutable verification evidence for every acceptance criterion.

## 3. Review and integrate evidence

- [ ] Review the full change from `origin/main` for correctness, scope,
  compatibility, secrets, release consistency, and deployment safety.
- [ ] Execute the formal review and store the receipt.
- [ ] Replay/integrate the exact reviewed revision against an independent clean
  target and preserve the integration receipt.
- [ ] Apply the reviewed package-distribution capability delta and refresh
  context without overwriting unrelated capability content.

## 4. Deliver through GitHub protection

- [ ] Resolve the exact intended source and evidence path sets and commit only
  those paths with intentional messages.
- [ ] Push normally, open/reuse the source pull request, observe all required
  checks, and request an ordinary merge without force/admin bypass.
- [ ] Resolve the merged `main` commit, then open/reuse and normally merge the
  follow-up evidence/capability pull request if the Empirical delivery record
  requires it.
- [ ] Verify the resulting default-branch history, working-tree convergence,
  and delivery receipt before publication.

## 5. Authorize and publish the immutable release

- [ ] Reconcile absence or exact identity of `v0.24.0`, the GitHub release,
  `empirical-sdd@0.24.0`, and `latest` immediately before mutation.
- [ ] Present the exact merged commit, package, version, and dist-tag and obtain
  the publication authorization required by Empirical.
- [ ] Create/reuse the exact GitHub release so trusted publishing runs; observe
  workflow checks and notify the user if the protected npm environment needs
  human approval.
- [ ] Verify tag target, release metadata, npm integrity/version, and `latest`;
  stop on any immutable conflict.
- [ ] Install the registry artifact into a new temporary consumer and repeat
  CLI, public-entrypoint, and MCP smoke checks.

## 6. Confirm inventory and roll out serially

- [ ] Present discovered inventory facts: `development1` is a connected KVM VPS
  candidate with no current Empirical executable; other connected BB machines
  are local/non-VPS. Obtain confirmation for first-time install on that host and
  exact identities/order for any additional VPS targets.
- [ ] Build a redacted fixed-order ledger and preflight each confirmed target's
  current version/absence, package context, prefix ownership, and non-interactive
  writability without mutation.
- [ ] For each host in order, install exact `empirical-sdd@0.24.0` in the
  approved context, run `empirical install --yes`, verify exact version, and run
  bounded help/MCP smoke before advancing.
- [ ] On the first failure or unknown outcome, observe state once, record the
  stopping point, and leave later hosts unmodified.
- [ ] Report successful, already-current, failed, inaccessible, unresolved, and
  unattempted hosts separately with before/after versions and no secrets.
