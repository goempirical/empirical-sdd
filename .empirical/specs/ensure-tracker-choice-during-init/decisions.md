# Ensure Tracker Choice During Init Decisions

## D-001: Persist an explicit provider-free disabled record

Status: Accepted

### Evidence

- A missing `.empirical/tracker.json` currently means both never asked and
  explicitly disabled.
- Repair cannot recommend tracking only for the former unless those states are
  distinguishable.
- Runtime already treats a missing provider policy as local-only and performs no
  provider request.

### Options

1. Continue using file absence for both states.
2. Add tracker choice fields to Schema 5 project configuration.
3. Store a strict disabled setup record in `.empirical/tracker.json` and map it
   to no provider policy at runtime.

### Chosen approach

Choose option 3. It keeps tracker setup in one ownership-bounded path, avoids a
Schema 5 change, and lets policy consumers retain `TrackerPolicy | null` while
Init can distinguish configured, disabled, and unconfigured states.

### Trade-offs and risks

- Loaders must distinguish the disabled record before strict provider-policy
  parsing.
- Older versions would reject the new record if used after downgrade; the
  release notes must state that explicit No tracking uses the new patch format.
- Applying a provider policy or disabling tracking must remain atomic.

### Verification

Test missing, disabled, v1, v2, malformed, disable, apply, and byte-preserving
repair paths, including zero provider calls for disabled state.

## D-002: Make Track all the recommendation, not an automatic provider choice

Status: Accepted

### Evidence

- Provider setup requires host credential access plus an explicit target and
  state mapping; Init cannot safely invent those values.
- The user's desired default is one ticket for every feature, which corresponds
  to Tracker Policy v2 ticket behavior `ensure`.
- No tracking must remain a valid explicit answer.

### Options

1. Silently remain local-only and expose Configure tracker as a side option.
2. Automatically select a provider and target from environment or repository
   metadata.
3. Recommend Track all, require Track all or No tracking, and enter reviewed
   provider discovery only after Track all is chosen.

### Chosen approach

Choose option 3. It gives the recommendation real prominence without guessing
credentials, providers, targets, or mappings. Track all fixes ticket behavior
to `ensure`; visibility remains an explicit reviewed provider-policy setting.

### Trade-offs and risks

- First-run interactive setup gains one required decision and provider setup can
  take longer when the recommendation is accepted.
- Non-interactive defaults retain a provider-free compatibility path, while the
  user-facing agent contract always obtains the explicit choice.

### Verification

Assert Apply and Customize cannot bypass the question, Track all builds only an
`ensure` policy through preview, and No tracking reaches final Save without any
provider request.

## D-003: Ship as 0.24.1 without changing Schema 5

Status: Accepted

### Evidence

- The defect was introduced with guided tracker onboarding in 0.24.0.
- Existing project configuration and Tracker Policy v1/v2 remain compatible.
- The change corrects setup prompting and adds a provider-free setup record; it
  does not change workflow-state compatibility or package exports.

### Options

1. Patch 0.24.1 as a backward-compatible correction.
2. Minor 0.25.0 with a Schema or public policy redesign.
3. Modify the already immutable 0.24.0 release.

### Chosen approach

Choose option 1. Publish a new immutable patch after protected PR merge and full
release verification. Never replace 0.24.0 or its tag.

### Trade-offs and risks

Downgrading after selecting No tracking is unsupported because 0.24.0 does not
recognize the disabled setup record; upgrading and rerunning Init is the safe
path.

### Verification

Keep Schema 5 unchanged, update every canonical version surface to 0.24.1, run
the complete release gate, inspect the package, publish through the trusted
release workflow, and verify npm `latest` and the GitHub release commit.
