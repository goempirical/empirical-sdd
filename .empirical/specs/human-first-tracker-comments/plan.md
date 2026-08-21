# Plan: Human-First External Tracker Milestone Comments

## 1. Add the pure milestone presentation boundary

- Create `src/tracker-comments.ts` with internal semantic view and payload types.
- Derive deterministic human work labels and truthful status/completion
  headlines from `TrackerProjection`.
- Canonicalize, redact, bound, and anti-mention/anti-marker sanitize summaries
  and blockers before provider serialization.
- Select only safe credential-free HTTPS artifact URLs and label them from
  trusted media types without paths or receipt identifiers.
- Implement GitHub Markdown, Linear Markdown, and Jira ADF serializers with
  their provider-specific exact marker representations.
- Implement pure exact/new/legacy marker inspection that classifies absent,
  matching, and malformed expected-key evidence.

Acceptance criteria: AC-1, AC-2, AC-3, AC-4, AC-6.

## 2. Lock the semantic and serializer contract with focused tests

- Add `tests/tracker-comments.test.ts` with a table covering ordinary
  specification/plan/implementation, verification, review, blocked,
  awaiting-human, and every final completion level.
- Assert duplicate summary/action text appears once and absent summaries render
  a concise valid hierarchy.
- Assert all providers carry equivalent human meaning and exact provider-safe
  markers while Jira uses structured ADF rather than Markdown text paragraphs.
- Cover safe evidence, repeated labels, unavailable/native-upload evidence, and
  unsafe URLs.
- Feed multiline Markdown, HTML delimiters, mention-like text, marker protocols,
  raw digests, secret-like values, bidi controls, long strings, and odd paths to
  prove deterministic escaping and bounds.
- Cover exact new and legacy marker recognition plus partial, surrounded,
  duplicated, and conflicting marker classification.

Acceptance criteria: AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-9.

## 3. Wire provider-native payloads into Policy v2 synchronization

- Replace the generic `renderMilestone` call in `projectRemoteTicketV2` with
  provider rendering derived from the existing comment effect key.
- Update `publishRemoteMilestone` so GitHub and Linear post their Markdown body
  and Jira posts dedicated ADF plus the exact comment property.
- Use the pure marker inspector on every complete reconciliation page; treat a
  malformed expected-key representation or more than one matching comment as a
  fail-closed tracker error.
- Leave `shouldPublishMilestone`, transition-first ordering, Policy v1 paths,
  issue-description helpers, artifact publication, pending record schemas,
  effect keys, and acknowledgement writes unchanged.

Acceptance criteria: AC-4, AC-5, AC-7, AC-8.

## 4. Extend end-to-end adapter regression coverage

- Update old payload assertions to the human-first hierarchy and visible-field
  exclusions.
- Add lost-response reconciliation for the new representation on GitHub,
  Linear, and Jira.
- Add legacy marker recovery on each provider and prove no second comment POST.
- Add malformed and duplicate marker cases that preserve durable failed/pending
  state without overwriting remote comments.
- Retain or explicitly assert cadence eligibility, transition before comment,
  byte-for-byte descriptions, Policy v1 compatibility, artifact
  acknowledgement/retry, and credential redaction.

Acceptance criteria: AC-5, AC-7, AC-8, AC-9.

## 5. Produce visual verification evidence

- Build a local provider-like HTML fixture from representative ordinary,
  awaiting-human, blocked, review, and final comment content.
- Render it in a browser at desktop width and inspect the hierarchy, spacing,
  action emphasis, evidence labels, and subtle marker treatment.
- Capture the fixture and screenshot as immutable evidence for the UI criteria.
- Assert the rendered page contains no raw feature slug, digest, receipt ID,
  raw repository path, revision/completion fields, or Markdown leakage.

Acceptance criteria: AC-1, AC-2, AC-3, AC-10.

## 6. Verify, review, and integrate

- Run the focused tracker-comment and tracking suites during implementation.
- Run the configured type/check gate, `git diff --check`, and the complete clean
  `bun run ci` suite through Empirical evidence commands.
- Collect immutable test, browser, screenshot, and review receipts mapped to all
  acceptance criteria.
- Perform the configured code review, address findings, and re-run affected
  evidence.
- Integrate the reviewed delta against the independent target checkout, archive
  the modified capability projection, and stop before any unrequested publish.

Acceptance criteria: AC-1 through AC-10.
