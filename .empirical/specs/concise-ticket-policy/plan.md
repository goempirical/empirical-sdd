# Concise Ticket Policy Plan

1. Extend the project configuration and public types with a nested
   `interaction.questions` setting. Normalize missing Schema-5 data to
   `detailed`, select `concise` in recommended setup, preserve nested values on
   configure, expose the effective value in every action packet, and add the
   matching CLI and MCP inputs.
2. Add a strict optional Tracker Policy v2 `ticketRules` matrix, a defensive
   recommended preset, and a pure resolver using the existing request change
   classifier plus persisted workflow profile. Reject partial/unknown matrices
   and combinations with non-ensure ticket behavior while preserving all v1
   and rule-less v2 policy paths.
3. Refactor tracker status and synchronization so required rules enter the
   existing attach/reconcile/guarded-create path, optional rules attach one
   explicit reference but remain local with zero credential/provider access
   when no reference exists, and off rules remain provider-free. Surface the
   resolved change type and requirement without changing provider adapters.
4. Make interactive setup choose a compact ticket preset, support explicit
   custom matrix cells, and render concise setup/action/status summaries when
   selected. Keep detailed output intact and never compact away failures,
   ambiguities, approval gates, missing evidence, or exact completion actions.
5. Propagate both controls through generated agent integrations and the MCP
   action harness. In concise mode instruct agents to ask only a material
   blocking question and never ask whether to create an optional missing
   ticket.
6. Add a provider-independent executable demo that starts a Complex feature
   with no ticket, drives production synchronization using only injected OAuth
   and deterministic mock transport, and reports exactly one create, one
   binding, and zero live calls. Build and execute it from the clean packed
   consumer harness.
7. Add focused configuration, setup, CLI, core, MCP, integration, tracking,
   demo, compatibility, and failure-boundary tests; update product, protocol,
   tracker, MCP, and demo documentation; then run formatting checks, focused
   suites, package smoke tests, and complete CI.
8. Record immutable implementation, test, and independent review receipts,
   replay the reviewed capability deltas against an independent target, run
   its verification command, and stop at the integrated ceiling unless the
   user separately authorizes delivery or publication.
