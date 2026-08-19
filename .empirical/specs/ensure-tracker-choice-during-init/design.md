# Ensure Tracker Choice During Init Design

## Evidence

Empirical 0.24 already supports strict Tracker Policy v1/v2, guided provider
discovery, semantic mapping, preview, and `preserve`, `disabled`, or `apply`
setup changes. The defect is at the onboarding boundary:

- the generated Init skill lists Configure tracker beside Apply recommended;
  Apply can therefore finish without asking a tracker question;
- the interactive CLI labels Local-only as the first-run default and returns
  `preserve` when no tracker policy exists;
- disabling tracking deletes `.empirical/tracker.json`, making an explicit No
  tracking choice indistinguishable from a repository that was never asked.

## Design

### Durable setup state

Treat `.empirical/tracker.json` as one strict setup record with three observable
states:

1. Missing file: no tracker decision has been made.
2. `{ "schemaVersion": 1, "mode": "disabled" }`: the user explicitly chose No
   tracking.
3. Existing Tracker Policy v1/v2: provider tracking is configured.

Add one loader that validates and returns this state. Existing policy callers
continue receiving `TrackerPolicy | null`; the disabled record maps to `null`
for runtime behavior, so status and synchronization remain provider-free.
Applying a provider policy replaces the disabled record atomically. Disabling
tracking atomically writes the strict record instead of deleting the file.

### Setup summary and interactive flow

Pass the complete setup state into summary rendering:

- unconfigured: show Track all work as recommended, No tracking as the explicit
  alternative, and state that a choice is required;
- disabled: show No tracking as the current/effective choice;
- configured: show the existing provider, ticket behavior, visibility, and
  credential environment-variable names.

When an interactive first run or repair has no decision, Apply/Keep and
Customize both enter the tracker question before final Save. Track all enters
the existing provider discovery flow and fixes ticket behavior to `ensure`;
No tracking returns the disabled setup change without provider access. The
complete effective summary is rendered after this choice and before mutation.
Repair with a configured policy or disabled record preserves it by default.

Non-interactive setup remains compatible: explicit `--tracker-input` continues
to apply or disable tracking, while `--defaults` records the provider-free
disabled state. MCP callers remain supported, and the generated agent contract
requires an explicit tracker change so user-facing Init cannot silently rely on
that compatibility path.

### Generated Init contract

Strengthen the managed global skill so an absent tracker decision always
produces one direct question with Track all work recommended and No tracking
available. Track all maps to Policy v2 `ticket: ensure` and provider discovery;
No tracking maps to `mode: disabled`. Existing configured or disabled state is
preserved on repair. The skill continues to forbid binding, synchronization,
feature creation, delivery, and publication during Init.

## Compatibility and release

- Schema 5 and Tracker Policy v1/v2 remain unchanged.
- Existing provider policies remain byte-compatible.
- Missing tracker files keep their historical local-only runtime behavior until
  explicit Init is invoked.
- The strict disabled record is additive and handled as local-only by runtime,
  status, and Doctor.
- The correction ships as patch version 0.24.1 with a changelog entry and no
  migration action beyond rerunning Init when a repository lacks a decision.

## Verification

- Unit-test all three setup states and summary variants.
- Exercise interactive Apply and Customize paths with No tracking, final Save,
  cancellation, and repair preservation.
- Assert generated Init text requires the choice and maps Track all to ensure.
- Retain provider policy parsing, provider-free status, Doctor, and no-network
  repair coverage.
- Run focused tests, complete `bun run ci`, package inspection, protected PR
  checks, and immutable 0.24.1 release verification.

## Risks and mitigations

- A new record in the policy path could be mistaken for malformed policy.
  Centralize setup-state parsing and keep `parseTrackerPolicy` strict for callers
  that require a provider policy.
- Interactive flow could mutate before final confirmation. Keep discovery and
  preview read-only and apply the selected change only after Save.
- Repair could rewrite a current decision. Preserve mode performs no tracker
  write or provider request, and regression tests compare exact bytes.
