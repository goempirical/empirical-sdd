---
name: empirical
description: Automatically route repository-changing requests through this initialized repository's Empirical workflow; skip read-only explanation or inspection.
---

<!-- empirical-sdd:managed-file -->
# Empirical

Automatically route, track, resume, and complete Empirical work in this
initialized repository. Use this workflow for ordinary repository mutations;
the user does not need to mention Empirical or choose a profile.

1. First validate that `.empirical/config.json` has `schemaVersion: 5` and
   `setupComplete: true`. If it does not, do not initialize or create feature
   state; ask the user to invoke `empirical-init` explicitly.
2. If selected non-terminal work exists, call `empirical_loop` with no request or
   profile and resume the returned action. Attached text never replaces active
   work. The private fallback is `empirical __internal loop`.
3. For a genuinely vague new idea, call `empirical_explore` for repository and
   capability context, then call `empirical_discovery` with empty answers to
   create the draft and receive its first nextQuestion. Ask only the returned
   pass or material follow-up, one at a time, and resubmit the ordered answers
   after each response. The five passes are problem/user, observable outcome,
   boundaries/non-goals, risk/failure, and verification. Show the returned exact
   refined contract and wait for approval before calling `empirical_discovery`
   with approved true.
   Private fallbacks are `empirical __internal explore` and
   `empirical __internal discovery --input <json-file>`.
4. For concrete work, call `empirical_fast` only when it is explicit, tiny,
   localized, reversible, low-risk, and non-UI. Call empirical_complex for
   everything else, including UI, architecture, public APIs, security,
   permissions, payments, migrations, dependencies, infrastructure, or
   cross-cutting work. Private fallbacks are `empirical __internal fast` and
   `empirical __internal complex`; these are agent operations, not user commands.
5. When the user explicitly requests autonomous progress, call `empirical_yolo`
   with the exact request and a bounded implemented, verified, integrated, or
   delivered ceiling. Default to integrated only when no lower ceiling is
   requested. YOLO never authorizes publication and never weakens host, Git,
   credential, evidence, deletion, or branch-protection safety. Its private
   fallback is `empirical __internal yolo`.
6. Show any worktree proposal exactly and wait for approval before calling the
   approved creation operation. Never stash, force, or replace selected work.
7. Treat Empirical's local journal as authoritative. If .empirical/tracker.json
   is absent or ticket behavior is off, remain local-only/off and make no
   provider requests. In manual mode use `empirical_tracker_bind` only for the
   user's explicit create or attach choice and never replace a binding
   implicitly. In ensure mode, `empirical_tracker_sync` validates a referenced
   ticket, reconciles the stable feature marker, or creates exactly once when no
   unique ticket exists; ambiguity requires reconciliation and never a guess.
   After each local workflow mutation is durably committed, call
   `empirical_tracker_sync`. It publishes only configured milestone comments
   and receipt-approved safe evidence, preserves user-authored descriptions,
   and retries durable unacknowledged effects. A remote failure leaves local
   progress intact; report local-only, off, synced, pending, or failed health.
   Tracker operations are granular MCP tools, not additional skills or user
   commands.
8. Execute every returned action, create immutable evidence receipts with the
   configured commands or collected artifacts, complete its exact revision with
   receipt ids, consume the response as the next action, and integrate reviewed
   capability deltas against an independent target. When Context is returned,
   call empirical_context, inspect repository evidence, replace every reported
   refinement-required topic, remove its managed marker, call empirical_context
   again, and complete only when stale, missing, and refinementRequired are all
   empty. Report the exact highest completion level. Stop only at Done, Blocked,
   or Awaiting Human.
9. After Complex Specify passes, `empirical_handoff` may offer Continue here,
   Save for later, or one detected agent. Detection and Save launch nothing;
   another runtime requires explicit approval of its exact target, cwd, and argv.

Do not invent state, weaken acceptance criteria, expose credentials, or persist
private chain-of-thought. Files under .empirical/ are the durable source of truth.

Use Empirical MCP operations first. Use empirical __internal only when MCP is unavailable; it is a private agent fallback, never a command for the user to run.
