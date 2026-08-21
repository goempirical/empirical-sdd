# Design: Human-First External Tracker Milestone Comments

## Overview

Replace the single machine-oriented milestone Markdown renderer with one pure
semantic view builder and three provider serializers. The tracker effect key,
visibility decision, transition ordering, durable pending record, artifact
effects, and acknowledgement identity remain unchanged. Only the milestone
payload and exact-marker reconciliation boundary change.

The implementation will live in an internal `src/tracker-comments.ts` module so
its state matrix and serializers can be tested without exercising provider I/O.
It will not be exported through the package's public index.

## Data flow

1. `projectRemoteTicketV2` derives the existing comment effect key from the
   committed projection and acknowledges the state transition as it does today.
2. The milestone module converts the projection into a bounded semantic view:
   humanized work label, truthful headline, optional summary, optional required
   action, and safe linked evidence.
3. The provider branch serializes that view as GitHub Markdown, Linear
   Markdown, or Jira ADF and adds the provider's exact machine marker.
4. Before creating a comment, reconciliation scans every complete provider
   page and classifies the expected marker as absent, exact, or malformed.
5. Exactly one matching comment is acknowledged, no matches create one new
   comment, and malformed or multiple evidence fails closed. Artifact effects
   continue independently after comment acknowledgement.

## Semantic milestone view

The internal view contains no Markdown or ADF:

- `work`: sentence-cased words derived from the validated feature slug and
  bounded independently from remote text.
- `headline`: fixed application-owned wording selected from status, phase, and
  the committed highest completion level.
- `summary`: the bounded committed summary when it adds information.
- `action`: a distinct `Action needed` or `Blocker` section for
  `awaiting_human` or `blocked`; duplicate summary/action text is rendered once.
- `evidence`: only validated HTTPS URLs, labeled from trusted media-type
  categories (`Screenshot`, `Document`, `Report`, `Notes`, or `Evidence`) and
  numbered deterministically when labels repeat.

Status takes precedence over phase, and final state takes precedence over
ordinary progress. Final headlines map exactly to the proof available:

| Committed state | Human headline |
| --- | --- |
| `awaiting_human` | Input needed |
| `blocked` | Work is blocked |
| specification phases | Defining the work |
| plan | Plan ready |
| implement/context | Implementation in progress |
| verify | Verification in progress |
| review | Ready for review |
| integrate | Integration in progress |
| deliver | Delivery in progress |
| publish | Publication in progress |
| final + `none` | Workflow complete |
| final + `implemented` | Implementation complete |
| final + `verified` | Verification complete |
| final + `integrated` | Integration complete |
| final + `delivered` | Delivery complete |
| final + `published` | Publication complete |

This mapping never infers delivery or publication from phase alone.

## Provider serialization

### GitHub

GitHub receives bounded Markdown with a level-two headline, bold work label,
plain summary, optional level-three action/evidence sections, and a final hidden
HTML comment containing the exact effect key. All human text is escaped before
insertion; the marker is built only from the validated effect key.

### Linear

Linear receives the same human hierarchy as bounded Markdown. Its marker is a
subdued `Managed by Empirical` footer link whose URL fragment contains the exact
effect key. The digest stays out of visible prose while the raw comment body
retains a searchable representation without relying on Linear preserving HTML
comments.

### Jira

Jira receives native ADF nodes: heading, strong work label, paragraphs,
provider-native section headings, bullet-list link nodes, and a subdued linked
footer. The exact effect key is carried in the footer link target and in the
existing `empirical-sdd-effect` comment property. A dedicated milestone ADF
serializer is separate from the generic description `jiraAdf` function.

## Marker compatibility and reconciliation

An identity helper derives all representations from the unchanged SHA-256
comment effect key:

- current GitHub: an exact machine-owned HTML-comment line;
- current Linear: an exact footer-link line;
- current Jira: an exact ADF link target plus comment property;
- legacy: the existing exact `[Empirical milestone](<...>)` line or Jira text
  node produced by the former generic ADF serializer.

Scanners match only complete provider-owned representations. A comment that
contains the expected effect key in a partial, duplicated, surrounded, or
otherwise unrecognized marker is malformed rather than absent. One comment may
carry both Jira body and property representations and still counts once.
Multiple matching comments or any malformed expected-key evidence raises the
existing bounded tracker reconciliation failure and leaves the pending effect
durable. Pagination limits and remote ordering do not change.

## Text and link safety

Before serialization, human text is normalized to one line, Unicode control
and bidirectional formatting characters are removed, HTML-comment delimiters
and marker-like protocols are neutralized, mention signs are made
non-notifying, secret/token patterns and raw SHA-256 digests are redacted, and
field-specific length limits are applied. Markdown metacharacters are then
escaped only in Markdown serializers; Jira receives structural text nodes and
never parses user text as markup.

Evidence links are emitted only when reparsing yields an HTTPS URL with no
credentials, control characters, secret-like query material, or excessive
length. The normalized URL is placed in a Markdown angle-bracket destination or
an ADF link mark. Invalid or unavailable links are omitted from the comment;
their existing artifact effect and tracker-health behavior is untouched.

## Compatibility boundaries

- `shouldPublishMilestone`, state transitions, tracker state mapping, and effect
  key derivation are not changed.
- Policy v1 continues through its existing projection paths.
- Policy v2 comments remain append-only; no update/delete request is added.
- Provider issue descriptions and legacy managed description helpers are not
  invoked by the new milestone path.
- Artifact collection, upload/link behavior, effect ordering, and durable
  acknowledgements are not changed.
- Existing pending records need no migration because their effect key and
  projection schema remain valid.

## Verification design

- Pure table tests cover every headline state, duplicate suppression, absent
  summaries, safe/unavailable evidence, link labels, and provider payload shape.
- Adversarial tests inject Markdown, HTML delimiters, mentions, marker text,
  secret-like values, bidi controls, long text, filenames, and unsafe URLs.
- Adapter tests cover new and legacy exact lost-response recovery and malformed
  or duplicate marker failure on GitHub, Linear, and Jira.
- Existing tests continue to prove cadence, transition-first ordering, Policy
  v1 behavior, unchanged descriptions, artifacts, and credential redaction.
- A local HTML fixture presents representative ordinary, awaiting-human,
  blocked, review, and final views in provider-like cards for browser and
  screenshot evidence.

## Rollback

The change is isolated to comment rendering and reconciliation. Reverting the
new module and call-site wiring restores the old visible payload; comments
already written by either format remain recoverable because the compatibility
scanner is additive and durable effect identities are unchanged.
