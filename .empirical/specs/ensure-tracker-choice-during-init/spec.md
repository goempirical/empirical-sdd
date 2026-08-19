# Ensure Tracker Choice During Init

## Request

> Fix empirical-init so initialization inspects existing tracker configuration and, when none exists, asks during setup with Track all work as the recommended default and No tracking as an explicit choice; preserve existing tracker configuration during repair, persist the confirmed choice safely, add regression coverage, merge the fix through a PR, and publish the next patch release.

## Goal

Make tracker onboarding an unavoidable, reviewable part of Empirical Init when
the repository has no prior tracker decision. Init recommends ensuring one
external ticket for every feature, permits an explicit provider-free opt-out,
and preserves either choice safely across repair without creating feature or
remote ticket state.

## Acceptance Criteria

- [ ] [AC-1] First-run Init and repair with no prior tracker decision show a
  Tracker section before any mutation with `Track all work` selected as the
  recommended choice and `No tracking` as an explicit alternative; applying
  the other recommended settings cannot bypass this decision.
- [ ] [AC-2] Choosing `Track all work` enters the existing guided Linear,
  GitHub Projects, or Jira discovery and preview flow and produces Tracker
  Policy v2 with ticket behavior `ensure`; only credential environment-variable
  names and approved canonical identifiers are persisted.
- [ ] [AC-3] Choosing `No tracking` persists a strict provider-free disabled
  setup record, performs no provider request, creates no ticket, and is shown
  as the current choice during later repair.
- [ ] [AC-4] Repair with an existing valid tracker policy or explicit disabled
  record preserves its bytes by default and performs no provider request unless
  the user explicitly chooses to reconfigure it.
- [ ] [AC-5] The generated global `empirical-init` contract requires the missing
  tracker choice, recommends tracking all work, maps that choice to `ensure`,
  and still forbids tracker binding or ticket creation during setup.
- [ ] [AC-6] Interactive Init previews the complete effective Verification,
  Parallel work, Decisions, and Tracker settings after the tracker choice and
  still supports Save or Cancel before mutation; private non-interactive input
  continues to accept explicit applied or disabled tracker changes.
- [ ] [AC-7] Focused setup, CLI, integration, tracking, and MCP regressions plus
  the complete release CI suite pass, and the correction is delivered and
  published as the next patch release without changing Schema 5.

## Scope

- User-facing first-run and repair guidance in the generated `empirical-init`
  skill.
- Setup-summary and interactive Init choice flow.
- A strict durable representation of an explicit provider-free opt-out.
- Tracker policy loading/configuration compatibility for configured, disabled,
  and never-answered states.
- Regression coverage, changelog/version preparation, protected PR delivery,
  and the next patch release.

## Non-goals

- Creating, attaching, or synchronizing a feature ticket during Init.
- Adding a tracker provider or changing existing provider discovery, target,
  mapping, credential, or projection security boundaries.
- Making remote tracker state authoritative over the local Empirical journal.
- Changing Schema 5, existing Tracker Policy v1/v2 files, or existing configured
  repository behavior without an explicit user choice.

## Verification

- Run focused setup, CLI configuration, integration, tracking, and MCP tests.
- Run `bun run ci`, `git diff --check`, and package-content inspection.
- Verify a clean demo repository cannot complete interactive or agent-guided
  setup without choosing Track all work or No tracking.
- Verify explicit No tracking survives repair byte-for-byte with zero provider
  requests, while an existing provider policy is also preserved byte-for-byte.
- Confirm all protected PR checks pass, merge the source PR, publish the next
  immutable npm/GitHub patch release, and verify the `latest` dist-tag.

## Capability Deltas

- `deltas/external-ticket-tracking.md` changes tracker onboarding from a silent
  local-only default to an explicit Track all/No tracking decision while
  preserving tracker optionality and one-way projection.
