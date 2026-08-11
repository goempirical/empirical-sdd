# Plan: Reconcile Explicit Init Capability Language

1. Validate that the delta replaces exactly the three stale requirement titles
   and introduces no runtime or package files.
2. Advance implementation as a source-neutral contract correction.
3. Run the configured full CI and collect a review receipt for the delta.
4. Integrate into `agent-integrations` against a clean independent worktree.
5. Search the resulting living specification for contradictory pre-0.23
   discovery, approval-boundary, and installation-separation claims.
