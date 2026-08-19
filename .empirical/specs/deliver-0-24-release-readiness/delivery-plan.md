# Delivery Plan

## Target

- Protected branch: `main`
- Observed pre-delivery head: `1a5e3fa20977a931342069728693136cd29c34b3`
- Source branch: `fix/0-24-release-readiness`
- Evidence branch: `evidence/0-24-release-readiness`
- Authorization ceiling: `delivered`

## Source commit paths

- `.agents/skills/empirical/SKILL.md`
- `.claude/skills/empirical/SKILL.md`
- `CHANGELOG.md`
- `src/coordination.ts`
- `src/delivery.ts`
- `src/doctor.ts`
- `tests/delivery.test.ts`
- `tests/doctor.test.ts`

These paths contain the reviewed release notes, regenerated activation
contracts, class-aware receipt validation, secret-free GitHub CLI configuration
reuse, and their regression tests. No `.empirical` state is part of the source
commit.

## Evidence commit paths

- `.empirical/capabilities/agent-integrations/spec.md`
- `.empirical/capabilities/autonomous-delivery/spec.md`
- `.empirical/capabilities/living-specifications/spec.md`
- `.empirical/context/manifest.json`
- `.empirical/specs/deliver-sdd-23-through-github/`
- `.empirical/specs/harden-0-24-release-readiness/`
- `.empirical/specs/deliver-0-24-release-readiness/`

The last directory intentionally includes the delivery operation's generated
`delivery-source.json`, which binds the exact source merge. The prior SDD-23
directory intentionally reconciles its already-merged delivery receipt and
compacted journal; it was preserved from the authoritative local delivery
state rather than discarded.

## Remote and release invariants

- Both commits use exact paths and stable idempotency markers.
- The evidence branch is created from `main` only after the source merge.
- No force push or direct `main` commit is permitted.
- `v0.24.0`, GitHub Release `v0.24.0`, npm `empirical-sdd@0.24.0`, and a
  `latest -> 0.24.0` change are outside this plan.
- No VPS target or install command is present.
