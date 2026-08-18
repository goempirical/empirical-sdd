# Release SDD-23 and Roll Out to VPS Hosts

## Request

> Merge the completed SDD-23 tracker onboarding and lifecycle synchronization work through the protected GitHub workflow, create and validate the next appropriate package release, then update every user-owned VPS that is discoverable from the existing deployment inventory to that exact released version. Use a staged rollout: verify the published artifact in a clean consumer, inventory hosts and current versions without exposing credentials, update hosts one at a time, run a smoke/version check after each update, stop on the first failed host without continuing, and report any hosts that cannot be safely identified or accessed. Do not force-push, bypass branch protection, overwrite unrelated remote changes, or publish an unverified artifact.

## Goal

Ship the already verified SDD-23 tracker work as the next semantically correct
Empirical package release, prove that the public artifact works for a clean
consumer, and then converge every explicitly inventoried, reachable user-owned
VPS that already runs Empirical to that exact release without broadening the
deployment target or hiding partial failure.

## Acceptance Criteria

- [ ] [AC-1] The source pull request contains the completed SDD-23 source,
  tests, documentation, capability evidence, and release preparation without
  unrelated user changes; it reaches `main` through an ordinary protected merge
  after required checks pass, with no force push or administrator bypass.
- [ ] [AC-2] The release candidate is `0.24.0`: the next alpha minor after
  `0.23.0`, because SDD-23 adds public workflow, MCP, configuration, and tracker
  behavior. `src/protocol.ts`, package metadata, lock data, help/version output,
  tests, generated context, and documentation agree on that version while the
  repository remains Schema 5.
- [ ] [AC-3] `CHANGELOG.md` has an empty `Unreleased` section, one dated
  `0.24.0` entry containing both the previously prepared `0.23.1` corrections
  and the SDD-23 additions, and compare links grounded in the existing
  `v0.23.0` tag. No untagged `0.23.1` release is represented as published.
- [ ] [AC-4] The full repository CI, enforced coverage, package-content checks,
  consistency checks, and clean packed-consumer install/import/version smoke
  pass before any release mutation.
- [ ] [AC-5] Publication occurs only after exact authorization for package
  `empirical-sdd`, version `0.24.0`, dist-tag `latest`, and the immutable merged
  `main` commit. The annotated tag, GitHub release, npm package, and dist-tag
  converge on that commit/version; an identical retry is harmless and any
  conflict stops without deleting or replacing an artifact.
- [ ] [AC-6] A fresh temporary consumer installs
  `empirical-sdd@0.24.0` from the public registry and successfully checks the
  CLI version plus supported runtime and MCP entrypoints before a VPS update.
- [ ] [AC-7] VPS discovery reads only existing explicit deployment inventory,
  saved SSH host aliases/profiles, or hosts the user identifies. It records
  bounded host labels and current Empirical versions without printing
  credentials. Local homelab devices, database endpoints, bare known-host keys,
  and inferred cloud addresses are not silently classified as VPS targets.
- [ ] [AC-8] Every reachable inventoried VPS is updated serially to exactly
  `empirical-sdd@0.24.0` using its existing supported package/install context,
  then its managed agent integrations are refreshed non-interactively and both
  `empirical --version` and a basic CLI smoke check succeed on that host.
- [ ] [AC-9] A host with an unknown install method, missing non-interactive
  permissions, failed package update, failed integration refresh, or failed
  smoke check is reported truthfully. The rollout stops at the first failed
  host and leaves all not-yet-started hosts untouched.
- [ ] [AC-10] The final report names the merged commit, release/tag/package
  convergence, clean-consumer result, ordered VPS targets, before/after version
  for each attempted host, any inaccessible or unidentified targets, and the
  exact stopping point without exposing secrets.

## Scope

- Prepare the existing completed SDD-23 work and its Empirical artifacts for
  release as `0.24.0`.
- Commit, push, open, validate, and normally merge the source/evidence changes
  required by the repository's protected delivery contract.
- Create and verify the exact GitHub/npm release only after the publication
  authorization gate is satisfied.
- Discover explicit VPS inventory read-only, preflight existing installations,
  and update recognized targets one at a time after public artifact validation.
- Preserve resumability by observing existing branches, pull requests, tags,
  releases, registry versions, and per-host versions before retrying effects.

## Non-goals

- Enabling a disabled cloud API, creating VPS instances, changing DNS,
  firewalls, operating systems, application services, or unrelated packages.
- Treating LAN homelab machines, database endpoints, or unlabelled
  `known_hosts` entries as production VPS inventory.
- Changing SDD-23 behavior after its completed implementation/review except for
  defects discovered by release verification.
- Publishing `0.23.1`, using a long-lived npm token, moving a conflicting tag or
  dist-tag, bypassing protected GitHub controls, or force-pushing.
- Guessing privilege escalation, install ownership, usernames, credentials, or
  remote paths on a host that fails preflight.

## Verification

1. Compare the candidate against `origin/main`, inspect the complete staged
   diff, and run version/changelog/context consistency checks.
2. Run the repository's formal CI and coverage gates, build and pack the npm
   artifact, inspect its contents, and install it in an isolated clean consumer.
3. Observe the source/evidence pull request checks and merged `main` commit.
4. After exact publication approval, verify tag target, GitHub release metadata,
   npm package metadata and integrity, `latest`, and a clean registry install.
5. Build a bounded VPS rollout ledger from explicit inventory. For each host in
   order, capture a redacted preflight/version result, perform the exact-version
   update and non-interactive integration refresh, then capture the version and
   CLI smoke result before continuing.
6. Stop on the first host failure and report unattempted, inaccessible, and
   unresolved hosts separately.

## Risks and Controls

- **Duplicate or conflicting publication:** reconcile immutable remote artifacts
  before every effect and fail closed on a mismatch.
- **Publishing unverified code:** require formal CI, package inspection, a clean
  packed consumer, and the exact merged commit before publication.
- **Wrong-host mutation:** accept only explicit inventory or user-confirmed
  targets and keep discovery read-only.
- **Fleet-wide partial failure:** roll out serially, verify each host, and stop
  before touching the next host when any stage fails.
- **Credential disclosure:** retain only credential source names and bounded
  host labels; redact command receipts and never print key/token contents.
- **Privilege or install-path damage:** reuse only a recognized existing package
  context and do not improvise `sudo`, ownership, or package-manager changes.

## Capability Deltas

- `deltas/package-distribution.md` advances release integrity to `0.24.0` and
  defines the fail-closed serial rollout contract for explicitly inventoried
  managed hosts.
