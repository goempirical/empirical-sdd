# Decisions: Deliver SDD-23 Through GitHub

Record concise, externally reviewable evidence and choices here. Do not store
private chain-of-thought, prompts, credentials, secrets, or scratchpad text.

## D-001: Wait for all CI without changing repository governance

Status: Accepted

### Evidence

- GitHub returns no branch protection and no rulesets for `main`.
- CI still runs five matrix jobs on every pull request.
- The user asked for normal reviewed merges and prohibited bypass behavior.

### Options

1. Merge immediately because no check is technically required.
2. Change branch protection/rulesets, then use required-check filtering.
3. Leave governance unchanged, observe every PR check, and merge only after all
   five jobs succeed.

### Chosen approach

Use option 3. It satisfies the requested safety boundary without expanding the
task into repository-governance changes.

### Trade-offs and risks

The CI wait is enforced by this delivery procedure rather than GitHub settings;
an interrupted operator must re-observe the checks before merging. Stable PR
markers and the final delivery receipt preserve resumability.

### Verification

Capture all five check conclusions and their completion time before each merge;
confirm merge events occur later and use no administrator flag.

## D-002: Split product source from Empirical evidence

Status: Accepted

### Evidence

- The working tree combines reviewed product changes with feature journals,
  receipts, context, living specifications, and delivery policy.
- Empirical's delivery contract requires distinct source and evidence PRs plus
  a source-merge binding in the evidence commit.

### Options

1. Put every path in one PR.
2. Commit product paths first, merge them, then carry only `.empirical/` onto a
   second branch based on the merged source.

### Chosen approach

Use option 2 with the explicit path sets in `design.md`.

### Trade-offs and risks

Two PRs take longer and the evidence branch must be based on the source merge,
but reviewers can distinguish executable behavior from its durable proof and
Empirical can reconcile both independently.

### Verification

Inspect each staged and PR file list. Source must contain no `.empirical` path;
evidence must contain no product-source delta against its merged base.

## D-003: Reconcile only after ordinary merges

Status: Accepted

### Evidence

- Empirical recognizes existing marker-owned PRs and validates marker commit
  against the remote head.
- Calling automated delivery before CI would request a merge immediately when
  no GitHub check is configured as branch-required.

### Options

1. Invoke automated delivery before creating PRs.
2. Create, validate, and merge both exact marker-owned PRs manually, then invoke
   Empirical to observe facts and write the receipt.

### Chosen approach

Use option 2. Remote mutation remains human-requested and CI-gated; Empirical
remains authoritative for the durable delivery completion record.

### Trade-offs and risks

The marker/body format and branch plans must exactly match the later delivery
input. Any drift stops reconciliation instead of silently adopting the PR.

### Verification

Compare PR head SHAs to their markers, compare remote merge commits, then
validate the resulting delivery receipt and `delivered` state.
