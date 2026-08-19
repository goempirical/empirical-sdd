# Harden 0.24 Release Readiness Decisions

## D-001: Validate persisted integration receipts by classification

Status: Accepted

### Evidence

- Behavioral integration receipts use a non-null capability claim and replay
  fields, while the core intentionally creates non-behavioral receipts with
  `classification: "non-behavioral"` and `claimId: null`.
- Doctor currently casts every JSON receipt to the behavioral interface and
  unconditionally calls `claimId.startsWith`, producing a false error.
- Both receipt classes are immutable canonical JSON with their own whole-object
  digest.

### Options

1. Special-case null claims inside Doctor and check only the digest.
2. Change historical non-behavioral receipts to fabricate a capability claim.
3. Add one class-aware persisted-receipt verifier beside the receipt types.

### Chosen approach

Choose option 3. Doctor and any future repository inspector receive the same
complete validation behavior, existing receipt bytes remain compatible, and no
fake behavioral state is introduced.

### Trade-offs and risks

- The discriminator is explicit only on non-behavioral receipts because existing
  behavioral receipts predate it; absence therefore continues to mean behavioral.
- Runtime type checks must precede property operations so malformed JSON yields
  a controlled error rather than hiding another exception.

### Verification

Create genuine behavioral and non-behavioral fixtures, tamper and mix their
fields, snapshot repository bytes around Doctor, and assert exact findings.

## D-002: Pass only the GitHub CLI configuration directory to `gh`

Status: Accepted

### Evidence

- The shell-free runtime deliberately inherits only a small non-secret
  environment and strips `HOME`, so an otherwise authenticated `gh` reports no
  logged-in host.
- GitHub CLI officially supports `GH_CONFIG_DIR` and defines deterministic
  XDG, Windows AppData, and home-directory fallbacks.
- `GH_CONFIG_DIR` is a locator, not a credential; `gh` itself owns stored-token
  access and host permission enforcement.

### Options

1. Inherit `HOME` and the broader user environment for every command.
2. Read the GitHub token and pass `GH_TOKEN` directly.
3. Compute and pass only `GH_CONFIG_DIR` for built-in `gh` commands.
4. Keep the temporary executable-wrapper workaround used during diagnosis.

### Chosen approach

Choose option 3. It restores normal host authentication while preserving exact
argv, minimal inheritance, credential ownership, and existing GitHub permission
checks.

### Trade-offs and risks

- A host with a custom layout must expose its standard `GH_CONFIG_DIR`; Empirical
  will not search arbitrary files.
- The locator is visible to the child process but only its key, never its value,
  is retained in runtime results.
- Missing login remains an error and is not repaired automatically.

### Verification

Test every precedence branch, inspect the default runner's process environment,
prove Git/npm commands do not receive the locator, and ensure command receipts
and returned results omit its value.

## D-003: Reconcile local activation through the existing repair boundary

Status: Accepted

### Evidence

- Doctor correctly reports the two marker-owned project skill copies as drifted
  after the packaged template changed for SDD-23.
- Init repair already validates roots, preserves unmanaged content, and replaces
  only Empirical-owned integration bytes.

### Options

1. Hand-edit the two stale skill files.
2. Ignore drift because the package template itself is correct.
3. Run ownership-aware repair with tracker preservation and verify convergence.

### Chosen approach

Choose option 3. It exercises the same supported upgrade behavior users will
run and proves the repair path rather than only matching bytes manually.

### Trade-offs and risks

Repair must receive explicit preserve settings so no tracker access or feature
creation occurs. Unmanaged collisions remain visible rather than overwritten.

### Verification

Compare the first and second repair reports, verify unchanged tracker bytes,
and require Doctor's project-integration finding to be ready.
