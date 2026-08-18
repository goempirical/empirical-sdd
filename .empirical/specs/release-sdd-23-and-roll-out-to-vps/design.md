# Design: Release SDD-23 and Roll Out to VPS Hosts

## Release Candidate

The release-preparation change advances the canonical product version from
`0.23.1` to `0.24.0` while preserving Schema 5. The last public npm version and
Git tag are `0.23.0`; the repository's untagged `0.23.1` changelog material is
folded into `0.24.0` so release history remains grounded in immutable tags.
Every source, fixture, generated-context, and documentation version surface is
updated consistently before verification.

## Protected Delivery

The complete candidate is reviewed as an intentional diff from `origin/main`.
Empirical's delivery record owns idempotency for commits, branch pushes, pull
requests, checks, and ordinary merges. Source delivery contains SDD-23 runtime,
tests, user documentation, and release metadata. Evidence delivery contains the
completed feature journals, receipts, capability delta/integration artifacts,
and the release feature's reviewed evidence. Neither flow force-pushes, requests
an administrator bypass, nor overwrites a non-matching remote artifact.

The merged `main` commit is resolved again after protected delivery and becomes
the sole eligible publication commit. Local branch SHAs are never substituted
for that remote fact.

## Verification Pipeline

Before delivery, run the project's formal CI command, including unit tests,
coverage floors, TypeScript build, package exports, MCP smoke, documentation and
context consistency. Pack the candidate and install it into a fresh temporary
consumer to test the CLI version and each supported public entrypoint without
repository-local resolution.

After publication, repeat the consumer smoke against
`empirical-sdd@0.24.0` fetched from npm. Registry metadata, integrity, and the
`latest` dist-tag must agree with the authorized release. A package installed
from the registry—not the source tarball—is the rollout prerequisite.

## Publication Boundary

Publication is a separate exact mutation. Immediately before it, reconcile:

- package: `empirical-sdd`
- version/tag: `0.24.0` / `v0.24.0`
- dist-tag: `latest`
- commit: the immutable merged `origin/main` commit
- absence or identity of the npm version, Git tag, and GitHub release

The operation proceeds only with an Empirical publication authorization bound
to those values. The repository's GitHub Release workflow performs trusted npm
publishing; a protected `npm` environment approval remains a human GitHub gate
if configured. Retries accept identical artifacts and stop on any conflict.

## VPS Inventory and Preflight

Inventory sources are ordered and read-only:

1. named deployment inventory/configuration in the current user environment;
2. named Agentum or BB remote-machine records;
3. explicit SSH aliases with enough context to establish deployment intent;
4. host identities supplied or confirmed by the user.

Known-host fingerprints, IPs found in prose, cloud database endpoints, and
local machines are insufficient. Current discovery establishes that Agentum
has only a local host; BB has a connected KVM VPS candidate named
`development1`, while `omarchy`, `dyaus`, and the MacBook are local/non-VPS.
The `development1` preflight finds Ubuntu/KVM and a user-owned FNM npm context,
but no `empirical` executable in that user's shell. This remains a reported
candidate rather than an automatic install target until the user confirms
whether absent installations should be added and whether other VPS hosts exist.

For each confirmed target, preflight records only a bounded host label, OS/
virtualization classification, current version or absence, executable path,
package manager, global prefix, and whether the install location is writable
without prompting. It does not read or print credential contents.

## Serial Rollout State Machine

After the registry smoke, confirmed hosts are processed in fixed order:

1. Re-run read-only preflight and compare it with the planned install context.
2. For an existing npm installation, install the exact package spec
   `empirical-sdd@0.24.0` in that same user-owned context.
3. Run the newly installed `empirical install --yes` to refresh managed agent
   integrations without a selector prompt.
4. Require `empirical --version` to equal `0.24.0` and run a basic help/MCP
   startup smoke.
5. Persist a redacted host result before advancing to the next host.

An absent installation is installed only if the user explicitly includes that
host for first-time deployment. Unknown ownership, package managers, privilege
prompts, or path changes fail preflight. Any attempted update or smoke failure
halts the rollout; later hosts are not touched. No destructive rollback is
guessed. The report identifies the failed host so recovery can be explicit.

## Idempotency and Recovery

- A matching merged commit, branch, PR, tag, release, npm version, or host
  version is recognized and reused.
- Publication conflicts are immutable blockers, never delete-and-retry cases.
- A host already reporting `0.24.0` still receives the bounded smoke but no
  package reinstall is required.
- If a remote command result is unknown, observe the host version and package
  state before considering another update.
- Unreachable hosts remain unmodified and appear separately from failed and
  unattempted hosts.

## Security and Privacy

Receipts retain argument shapes and bounded labels, not SSH key material,
tokens, credential values, environment dumps, or unrestricted remote output.
No cloud service is enabled and no privilege escalation is improvised. GitHub
trusted publishing is preferred over long-lived npm credentials.
