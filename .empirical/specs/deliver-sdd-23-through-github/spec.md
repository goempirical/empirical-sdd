# Deliver SDD-23 Through GitHub

## Request

> Commit the already verified integrated changes, push the branch, open source and evidence pull requests to main, wait for every GitHub CI check, and merge them normally.

## Goal

Move the already verified and independently integrated SDD-23 plus `0.24.0`
candidate from the current checkout to `main` through reviewable source and
evidence pull requests, with every GitHub CI matrix job green before each
ordinary merge and a durable Empirical delivery receipt matching both remote
merge commits.

## Acceptance Criteria

- [ ] [AC-1] The source commit contains only product source, package metadata,
  tests, and user documentation for the already reviewed SDD-23/`0.24.0`
  candidate; Empirical state, receipts, living specifications, and project
  policy remain for the evidence commit.
- [ ] [AC-2] The source branch is pushed without force and one marker-owned pull
  request targets `main`; all five CI matrix jobs complete successfully before
  an ordinary merge is requested.
- [ ] [AC-3] The evidence commit is based on the merged source `main`, contains
  the Empirical feature journals/receipts, living specifications, refreshed
  context, delivery policy, and source-merge binding, and contains no product
  source delta.
- [ ] [AC-4] One marker-owned evidence pull request targets `main`; all five CI
  matrix jobs complete successfully before an ordinary merge is requested.
- [ ] [AC-5] Neither pull request uses force push, administrator bypass, direct
  default-branch writes, or deletion/replacement of conflicting remote facts.
- [ ] [AC-6] Empirical reconciles the already merged source and evidence pull
  requests and records a digest-valid delivery receipt whose branch, PR URLs,
  source/evidence commits, and merge commits match GitHub.
- [ ] [AC-7] The final remote `main` tree includes both the product candidate and
  its evidence while local delivery status reports `delivered`, not `published`.

## Scope

- Enable the exact GitHub `main` delivery target in project Policy v2.
- Split the reviewed working tree into intentional source and evidence commits.
- Push, open/reuse, observe CI, and ordinarily merge two marker-owned PRs.
- Reconcile those remote facts into the authorized Empirical delivery record.

## Non-goals

- Changing product behavior, acceptance contracts, or release contents.
- Creating tags, GitHub Releases, npm versions, or dist-tag changes.
- Enabling or changing GitHub branch protection/rulesets.
- Updating local machines, VPS hosts, operating systems, or unrelated packages.

## Verification

1. Inspect explicit source/evidence path sets and staged diffs before commits.
2. Observe all GitHub Actions checks on each PR until terminal; stop on failure.
3. Compare each merged PR head/merge commit and final `origin/main` tree.
4. Run Empirical delivery reconciliation and verify its immutable receipt.
5. Confirm no publication artifacts exist as a side effect.

## Risks and Controls

- **CI is not branch-required:** manually wait for every reported workflow job
  before invoking an ordinary merge; Empirical observes only merged facts.
- **Mixed source/evidence scope:** use explicit path lists and inspect the staged
  name set before each commit.
- **Duplicate PRs:** use Empirical's stable feature/commit marker and reconcile
  existing branch/PR state before creation.
- **Remote drift:** stop if a PR head, marker commit, base, or merge fact differs.

## Capability Deltas

None. This operational delivery applies already integrated behavior and changes
no product capability; existing CI and delivery regressions remain authoritative.
