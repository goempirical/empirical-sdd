# Canonicalize Tracker Artifact Root Decisions

## D-001: Resolve receipt paths from the canonical repository root

Status: Accepted

### Evidence

- macOS exposes the same temporary tree through lexical `/var` and canonical
  `/private/var` paths.
- The failing comparison uses `relative(canonicalRoot, resolve(root,
  artifact.path))`, mixing those namespaces.
- The subsequent `lstat`, `realpath`, digest, and containment checks already
  provide the intended defense in depth.

### Options

1. Resolve the artifact from `canonicalRoot` and keep all existing checks.
2. Canonicalize each lexical artifact path before the first containment check.
3. Special-case macOS `/var` and `/private/var` prefixes.

### Chosen approach

Use option 1. It is a one-line correction to the mismatched coordinate system,
is platform-neutral, rejects direct traversal before I/O, and preserves the
existing resolved-target check.

### Trade-offs and risks

- This intentionally treats the canonical checkout as the repository identity.
- It does not permit an artifact symlink: `lstat` still rejects the link before
  `realpath` is trusted.
- It avoids operating-system prefix knowledge and therefore covers any valid
  lexical root alias, not only macOS temporary directories.

### Verification

Add a deterministic aliased-root test, retain unsafe-artifact assertions, run
the tracker test file and full CI, then require the GitHub Actions matrix at the
updated commit.

## D-002: Apply canonical resolution at both artifact security checkpoints

Status: Accepted

### Evidence

- After correcting projection eligibility, the aliased-root regression reached
  Jira attachment discovery and then failed at the final pre-upload reread.
- `readTrackerArtifactBytes` repeated the same mixed-root comparison as
  `loadTrackerArtifacts`.
- The final reread intentionally revalidates containment, file type, size, and
  digest immediately before a provider effect.

### Options

1. Correct only initial projection eligibility and leave aliased uploads broken.
2. Remove the pre-upload reread and rely on the earlier projection check.
3. Apply D-001's canonical-root strategy independently at both checkpoints.

### Chosen approach

Choose option 3. This supersedes only D-001's single-line implementation
detail; its platform-neutral canonical-root strategy remains unchanged. The
pre-upload defense in depth is preserved rather than bypassed.

### Trade-offs and risks

The root is canonicalized twice across the projection lifecycle, retaining the
existing protection against an artifact changing between planning and upload.
Both checks must continue using the same containment and digest rules.

### Verification

The aliased-root Jira test exercises both checkpoints and the lost-response
recovery path; the unsafe-artifact test and full CI protect the fail-closed
boundary.
