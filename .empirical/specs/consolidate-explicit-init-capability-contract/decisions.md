# Decisions: Consolidated Capability Replay

## D-001: Replace every affected title in one delta

Status: Accepted

### Evidence

- Sequential uncommitted integrations share a captured committed target base.
- A later partial delta can therefore replay over the older target projection.

### Options

1. Depend on the two earlier partial integration outputs.
2. Directly edit the living capability.
3. Consolidate all seven replacements in one independently integrated delta.

### Chosen approach

Choose option 3.

### Trade-offs and risks

The delta repeats accepted contract text but becomes self-contained and safe to
replay from the committed base.

### Verification

Integrate once and search the resulting capability for every stale phrase.
