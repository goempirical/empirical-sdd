# Concise Ticket Policy Design

## Overview

Add two independent, composable controls:

1. Project configuration selects how much interactive presentation Empirical
   emits (`concise` or `detailed`).
2. Tracker Policy v2 may refine global `ensure` behavior with a strict
   change-type/profile requirement matrix.

The workflow state machine, approval gates, evidence rules, tracker target,
authentication boundary, and provider adapters remain unchanged.

## Project interaction configuration

`ProjectConfig` gains:

```ts
interaction: {
  questions: "concise" | "detailed";
}
```

`normalizeConfig` supplies `detailed` when the field is absent, preserving the
current behavior of existing Schema-5 files without rewriting them. New
`recommendedSetupSettings` explicitly selects `concise`. Configuration merges
the nested object like evidence/isolation/decisions.

The setting is available through:

- interactive setup customization;
- `--questions concise|detailed` for non-interactive CLI init/configure;
- `questions` on MCP init/configure inputs;
- `interaction.questions` on every `ActionPacket`.

CLI action/status renderers use the packet value. Detailed mode keeps the
existing sections. Concise mode emits the phase/revision/instruction, a compact
tracker line, only missing artifacts/evidence, and the exact completion action.
It never hides a stop, failure, approval, or ambiguity.

## Ticket-rule data model

Tracker Policy v2 gains one optional strict field:

```ts
ticketRules: {
  feature: { fast: Rule; quick: Rule; complex: Rule };
  fix:     { fast: Rule; quick: Rule; complex: Rule };
  chore:   { fast: Rule; quick: Rule; complex: Rule };
}

type Rule = "required" | "optional" | "off";
```

The field is allowed only when `ticket` is `ensure`. All keys are required and
unknown keys fail strict validation. Policies without the field take the
existing path unchanged.

The exported `features-and-large-fixes` preset is:

| Change type | Fast | Quick | Complex |
|---|---|---|---|
| feature | required | required | required |
| fix | optional | required | required |
| chore | optional | optional | optional |

Preset access returns a defensive copy so callers cannot mutate the canonical
matrix.

## Requirement resolution

`resolveTrackerTicketRequirement(policy, state)` returns the deterministic
change type, requirement, and whether a rules matrix was used. Change type uses
the existing `inferChangeType(state.request)` classifier. Workflow size uses
the persisted `state.profile`, including Quick as material work.

For legacy/global policies:

- v1 resolves to legacy manual behavior;
- v2 `off`, `manual`, or `ensure` without rules follows its existing branch;
- v2 `ensure` with rules follows the selected matrix cell.

`TrackerStatus` keeps the existing `ticket` field and adds optional
`changeType` and `ticketRequirement` fields only for a rule policy. This is
additive for structured consumers.

## Synchronization control flow

Synchronization loads policy and resolves the active requirement before any
credential or provider operation.

- `off`: return tracker-off state and a local projection; do not authenticate.
- `optional`, no binding/pending, no reference: return local-only optional
  state and projection; do not authenticate or query the provider.
- `optional`, exactly one reference: persist an attach intent and follow the
  existing target validation/synchronization path.
- a rule-backed request with multiple references: return a secret-free
  ambiguity failure without preparing an attach/create intent and stop before
  authentication. Rule-less v2 retains its existing durable ambiguity record.
- `required`: use the existing ensure attach → marker reconcile → guarded
  create flow.
- existing binding or explicit pending bind: continue the existing idempotent
  synchronization path unless the resolved rule is `off`.

No provider adapter receives a rule. Adapters continue to consume only the
validated intent, projection, target, and opaque runtime authentication.

## Setup and agent harness

Tracker setup offers one compact policy choice after provider/target mapping:

```text
Tickets [features+large-fixes]: features+large-fixes / all / none / custom
```

- `features+large-fixes` writes the recommended matrix with `ticket: ensure`.
- `all` keeps global ensure without rules.
- `none` writes global off.
- `custom` asks only the nine rule cells and previews the complete matrix.

Generated local skill guidance reads `interaction.questions`,
`tracker.changeType`, and `tracker.ticketRequirement`. It tells concise agents
not to ask about an optional missing ticket and to surface only actual
ambiguity/authentication/approval gates.

## Executable demo and package harness

`src/demo-ticket-policy.ts` creates a temporary repository, starts one Complex
feature request, persists a Linear Policy v2 recommended matrix, and supplies:

- a mock OAuth resolver returning an in-memory demo authorization;
- a deterministic transport sequence for empty marker search, one create,
  synchronization, and one milestone;
- no live network implementation.

It prints structured JSON containing effective mode, change type, requirement,
create count, binding key, provider-call count, and live-network count. The
package build includes `dist/demo-ticket-policy.js`; `test-package.ts` executes
it from the packed clean consumer and rejects any result other than one create,
one binding, and zero live calls.

## Compatibility and failure boundaries

- Project Schema stays 5; missing interaction configuration means detailed.
- Tracker Policy stays v2; missing rules preserves current global semantics.
- Tracker policy repair remains byte-preserving.
- Rule validation occurs before preview or persistence.
- Optional zero-ticket work branches before OAuth/environment/host-file
  resolution.
- All existing create ambiguity and idempotency records remain authoritative.

## Verification strategy

Focused tests cover configuration defaults/merges, CLI and MCP surfaces,
concise/detailed rendering, preset immutability, matrix validation and every
cell, status fields, required creation, optional reference attachment,
optional/off zero-I/O, legacy policy behavior, generated skills, demo output,
and packed-consumer execution. The complete package CI remains the final gate.
