# Decisions: Capability Contract Reconciliation

## D-001: Correct the living contract with a follow-up delta

Status: Accepted

### Evidence

- The 0.23 implementation, tests, and public documentation already use explicit
  Init plus repository-local automatic routing.
- Three inherited requirements in the integrated living capability still used
  the pre-0.23 global-workflow wording.

### Options

1. Leave the contradiction as historical context.
2. Edit the living capability directly without workflow evidence.
3. Create a focused follow-up delta that replaces the named requirements.

### Chosen approach

Choose option 3 so capability history and integration evidence remain durable.

### Trade-offs and risks

The corrective workflow adds a second integration receipt, but avoids an
untracked direct specification edit and changes no runtime behavior.

### Verification

Validate and integrate the delta, then search the living capability for the
stale global-workflow claims.
