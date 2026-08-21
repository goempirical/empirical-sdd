# Human-First External Tracker Milestone Comments

## Request

> I don't like the way Empirical comments on the external trackboard and want
> to enhance those comments.

## Goal

Make every Tracker Policy v2 lifecycle comment useful to a human reader at a
glance while preserving exact provider-safe recovery metadata, durable
idempotency, local workflow authority, and the configured publication cadence.

## Acceptance Criteria

- [ ] [AC-1] [UI] An eligible Linear, GitHub, or Jira milestone renders a
  human-first update whose primary hierarchy is a plain-language state headline,
  a human-readable work label, and the concise committed summary; a bare feature
  slug, raw revision, raw completion field, duplicate marker label, digest, and
  receipt identifier do not dominate or appear as visible status prose.
- [ ] [AC-2] [UI] Ordinary progress, verification, review, blocked,
  awaiting-human, and final updates use deterministic, distinct wording;
  awaiting-human visibly asks for input, blocked work visibly names the blocker,
  and implemented, verified, integrated, delivered, and published are never
  described as a higher completion level than the committed local state proves.
- [ ] [AC-3] [UI] Reviewable evidence with a validated durable URL is presented
  as a friendly link without a raw receipt id; evidence awaiting a provider-native
  upload or lacking a safe URL does not expose repository paths or
  "pending/unsupported" implementation diagnostics in the comment, while
  tracker health continues to report the actual artifact effect state.
- [ ] [AC-4] GitHub, Linear, and Jira use provider-appropriate milestone
  representations: human-readable Markdown for GitHub and Linear and structured
  Jira ADF isolated from description rendering. Each representation retains the
  exact effect marker in a non-distracting machine-owned location that remains
  searchable for reconciliation.
- [ ] [AC-5] A lost milestone response is reconciled without a second comment
  for every provider, including comments written in the pre-change marker form;
  duplicate, malformed, incomplete, or ambiguous marker evidence fails closed
  with durable pending/failed health and does not overwrite an existing comment.
- [ ] [AC-6] Feature labels, summaries, blockers, artifact labels, and URLs are
  deterministically bounded and escaped so multiline Markdown, HTML comment
  delimiters, link syntax, mention-like text, and unusually long input cannot
  spoof the template, notify users, reveal secret-like content, or alter the
  exact machine marker.
- [ ] [AC-7] Tracker Policy v2 `blockers-final`, `milestones`, and `revisions`
  retain their current eligibility semantics and transition-before-comment
  ordering; Policy v1 compatibility, ticket creation/binding, state mapping,
  artifact eligibility/upload behavior, and remote-effect acknowledgement keys
  remain unchanged.
- [ ] [AC-8] Lifecycle synchronization leaves every user-authored issue
  description byte-for-byte unchanged and does not edit historical milestone
  comments or replace append-only history with a rolling comment.
- [ ] [AC-9] Focused renderer and adapter tests cover the state matrix, safe and
  unavailable evidence, adversarial text, exact new and legacy markers,
  ambiguous/lost responses, credential redaction, and all three provider
  payloads; TypeScript checks and the complete clean `bun run ci` suite pass.
- [ ] [AC-10] [UI] Browser-rendered representative ordinary, awaiting-human,
  blocked, review, and final fixtures are captured as visual evidence and show
  the intended hierarchy without visible hashes, receipt ids, raw feature
  slugs, or provider-unsupported formatting.

## Scope

- Tracker Policy v2 milestone-comment presentation for Linear, GitHub, and Jira.
- Shared semantic status/view-model derivation with provider-specific Markdown
  or ADF serialization and exact marker placement.
- Humanized work labels, truthful state headlines, concise summaries, blockers,
  required-action language, and friendly safe evidence links.
- New-format and legacy-format lost-response reconciliation.
- Focused security, compatibility, adapter, and visual regression evidence.

## Non-goals

- Changing tracker visibility modes, their defaults, or milestone eligibility.
- Replacing append-only lifecycle history with one rolling or edited comment.
- Editing historical comments or migrating issue descriptions.
- Changing ticket creation, attachment, bindings, provider state mappings,
  artifact eligibility, upload ordering, or tracker authority.
- Adding mentions, notifications, configurable templates, localization, or new
  provider integrations.

## Risks

- Provider rendering differences could expose an exact marker or make it
  unrecoverable after an ambiguous response.
- Sanitized workflow text could still inject Markdown, links, or mentions if
  provider serialization is not structural and bounded.
- Friendly completion language could overclaim delivery or publication.
- Hiding unavailable artifact internals from comments could obscure a failure
  unless structured tracker health remains truthful.
- Changing marker presentation could strand an old pending effect unless legacy
  comments remain recognizable.

## Verification

- Add table-driven semantic-view and provider-payload tests for ordinary,
  verification, review, blocked, awaiting-human, and every completion level.
- Assert visible Markdown/ADF omits raw slugs, revisions, digests, receipt ids,
  unsafe paths, duplicate marker labels, and unsupported-upload prose.
- Exercise adversarial multiline Markdown, HTML delimiters, mentions, long
  strings, filenames, and URLs through each provider serializer.
- Prove new and legacy lost-response recovery and ambiguous-marker failure for
  GitHub, Linear, and Jira without duplicate remote effects.
- Preserve cadence, Policy v1, description, transition ordering, artifact, and
  credential-redaction regressions.
- Run the focused tracking suite, TypeScript/check gates, `git diff --check`, and
  the complete clean `bun run ci` suite.
- Render representative comments in a local browser fixture and collect both
  the fixture and screenshots as review evidence.

## Capability Deltas

- `deltas/external-ticket-tracking.md` modifies progress projection so eligible
  lifecycle comments are human-first while exact synchronization remains
  recoverable and provider-safe.
