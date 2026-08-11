# Empirical 0.23 demo

## Install once

```bash
npm install -g empirical-sdd
empirical install
```

Choose from the pinned 73-target catalog. Empirical writes the single explicit
`empirical-init` skill once per unique root and performs no runtime network
fetch during installation.

## Initialize deliberately

In Codex, invoke `$empirical-init`. The agent first shows current or recommended
Verification, Parallel work, and Decisions settings. Apply, customize, or
cancel; cancellation writes nothing. Initialization then persists Schema 5,
Policy v2, Manifest v2, supported runtime bridges, and marker-owned local
activation without creating feature state. In Claude Code use
`/empirical-init`; in Windsurf use `@empirical-init`.

Existing `0.22.x` repositories need the same explicit Init once after upgrade.
That repair preserves stored configuration, context, selected work, history,
and evidence unless you explicitly change a setup value.

## Normal mode

> Fix the punctuation typo in the README heading.

Routing assigns the contract-neutral floor, so Fast implements the change,
executes configured verification, records immutable test/review receipts, and
conditionally refines repository Context when source fingerprints changed, and
finishes at `verified`.

> Add expiring team invitations with revocation and audit history.

Routing assigns at least the behavioral floor. Complex freezes an impact
manifest and capability deltas, then advances through Specify, Design, Plan,
Implement, conditional Context refinement, Verify, Review, and independent
Integrate. If the request is
materially ambiguous, the agent conducts and persists the five Socratic passes
before drafting the contract.

The repository-local workflow drafts a known Complex request, conducts the
five-pass interview when the idea is materially ambiguous, and resumes the
exact selected revision when work already exists. A read-only request such as
“explain the invitation flow” does not enter Empirical, and missing or invalid
configuration never triggers implicit initialization.

## Bounded autonomous mode

> Implement and integrate the approved invitation feature
> autonomously through `integrated`; stop before external delivery.

YOLO stores standing authorization through `integrated`, then continues without
routine preference questions. It still stops for an unresolved product choice,
missing host permission, conflict, branch protection, credential boundary, or
other hard safety floor. It cannot authorize publication.

## Optional ticket mirror

> Mirror this feature to our Linear board and create its ticket.

The agent collects the board identifiers, normalized status mapping, and the
name of the host-provided credential variable. It stores no credential value.
After each local journal commit it projects the feature phase, status, exact
revision, completion level, and blocker summary to that one ticket. The same
flow supports attaching an existing Linear, GitHub, or Jira ticket.

If the provider is unavailable, local SDD work continues and reports tracker
health as `pending` or `failed`. A later ordinary continuation request resumes
the durable pending operation. If ticket creation has an ambiguous outcome,
Empirical performs bounded reconciliation using the persisted create marker. If
no unique ticket matches, it stops until the developer attaches the possibly
created ticket or explicitly confirms another create attempt that may create a
duplicate.

## Parallel work

Starting an unrelated request while a feature is selected returns a complete,
read-only Git worktree proposal. Literal approval creates exactly the displayed
branch and path from the displayed base commit. The original feature remains
selected only in its checkout; shared capability claims prevent conflicting
behavioral integrations.

## Delivery

When Policy v2 names a GitHub target and authorization covers `delivered`,
Complex integration can continue to Deliver. Empirical creates or converges one
source PR, waits for declared checks, merges normally, then creates and merges a
separate evidence PR bound to the source merge. No admin merge or force path is
available.

Publishing a package or release requires a separate explicit request containing
the exact package, version, dist-tag, merged commit, exact-request authorization,
and literal approval. Empirical queries the remote tag, GitHub release, npm
version, and dist-tag both before and after acting; a conflicting immutable
artifact blocks the operation.

## Upgrade

```bash
empirical update
```

This upgrades the package, reconciles the single managed `empirical-init` skill,
and removes marker-owned legacy global Empirical entrypoints. Run Init once in
each existing `0.22.x` repository to install automatic local activation. A
Schema 4 repository migrates atomically to Schema 5 on its first mutating
workflow operation.

## Uninstall safely

```bash
empirical uninstall
```

Interactive uninstall displays its complete scope and defaults to cancel.
Automation uses `empirical uninstall --yes` or `empirical uninstall --yes
--json`. Empirical removes marker-owned skills from every unique global catalog
root, removes valid owned selection metadata, and runs `npm uninstall -g
empirical-sdd` last. It preserves every project's `.empirical` history and
repository MCP/agent configuration, plus any unmanaged or unsafe global target.
