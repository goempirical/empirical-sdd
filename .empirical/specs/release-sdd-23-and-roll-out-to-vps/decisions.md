# Decisions: Release SDD-23 and Roll Out to VPS Hosts

Record concise, externally reviewable evidence and choices here. Do not store
private chain-of-thought, prompts, credentials, secrets, or scratchpad text.

## D-001: Select the release version

Status: Accepted

### Evidence

- The latest public npm version and Git tag are `0.23.0`.
- The repository is prepared as `0.23.1`, but that version has no immutable tag,
  GitHub release, or npm publication.
- SDD-23 adds public CLI/configuration, MCP, Policy v2, provider discovery,
  automatic ticket behavior, comments, and evidence projection.
- The project versioning policy assigns additive public behavior to an alpha
  minor release.

### Options

1. Publish the prepared patch as `0.23.1`.
2. Skip the unpublished patch and release the combined work as `0.24.0`.
3. Publish `0.23.1` first, then immediately publish `0.24.0`.

### Chosen approach

Release `0.24.0`. Fold the untagged `0.23.1` changelog material into the new
minor entry and keep `v0.23.0` as its compare base.

### Trade-offs and risks

Consumers do not receive an artifact numbered `0.23.1`, but no immutable public
history claims they should. The chosen version truthfully signals the additive
workflow surface and avoids a redundant publication.

### Verification

Check every canonical version surface, changelog headings/links, remote tags,
GitHub releases, npm versions, and the clean-consumer version output.

## D-002: Separate delivery from publication

Status: Accepted

### Evidence

- Repository policy requires protected GitHub delivery and exact publication
  authorization.
- The GitHub Release workflow performs npm trusted publishing and may require a
  separate protected-environment approval.
- The current SDD-23 implementation is locally verified and integrated but is
  not committed, merged, tagged, or published.

### Options

1. Create a local tag and publish before merge.
2. Merge verified source normally, resolve the resulting `main` commit, then
   authorize and publish that exact immutable commit.

### Chosen approach

Use option 2. Delivery converges first; publication is a later exact operation
bound to `empirical-sdd@0.24.0`, `latest`, and the merged commit.

### Trade-offs and risks

The additional gate takes longer and GitHub may pause for environment approval,
but it prevents a registry artifact from pointing at unmerged or unverified
source. A conflict at any immutable remote surface stops the process.

### Verification

Observe protected PR checks/merge, compare tag target to merged `main`, and
compare GitHub/npm metadata plus registry package smoke after publication.

## D-003: Use explicit inventory and serial rollout

Status: Accepted

### Evidence

- SSH configuration and Agentum expose no named VPS deployment targets.
- BB exposes a connected KVM machine named `development1`; its read-only
  preflight finds no Empirical executable for the connected user.
- BB's other connected machines are the local `dyaus` host, the documented
  local `omarchy` homelab host, and a MacBook.
- A bare known-host address and cloud database endpoints do not prove VPS
  ownership or deployment intent.

### Options

1. Infer targets from every reachable address and update them concurrently.
2. Use only explicit/user-confirmed VPS identities and update one at a time.
3. Release the package but omit host rollout entirely.

### Chosen approach

Use option 2. Treat `development1` as a candidate pending confirmation because
Empirical is absent, request any missing VPS identities, and process confirmed
targets serially after the public artifact passes a clean-consumer smoke.

### Trade-offs and risks

Explicit inventory can leave an unidentified host unchanged, but avoids
mutating local devices, databases, or unrelated servers. Serial rollout is
slower but bounds failure and gives every host an observable stopping point.

### Verification

Record redacted preflight and before/after version results in inventory order;
on a synthetic or real failure, confirm later hosts remain unattempted.

## D-004: Reuse recognized package ownership and do not guess escalation

Status: Accepted

### Evidence

- Empirical is distributed as an npm package and refreshes managed agent
  integrations through `empirical install --yes`.
- User-owned FNM/Bun/global package contexts differ between machines.
- Guessing `sudo`, another user, or an install prefix can damage ownership and
  produce a different executable than the one invoked by services/users.

### Options

1. Run one universal root-level install command everywhere.
2. Detect and reuse the existing user-owned install context; require explicit
   approval for a first-time install or an ownership change.

### Chosen approach

Use option 2 with an exact `empirical-sdd@0.24.0` package spec and then refresh
integrations through that executable.

### Trade-offs and risks

A host with an unknown or privileged install stops instead of being repaired
automatically. This is preferable to silently changing ownership or PATH.

### Verification

Preflight executable, package manager, prefix, and writability; require the
same executable context to report `0.24.0` and pass help/MCP smoke afterwards.
