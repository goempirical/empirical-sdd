# Decisions: Human-First External Tracker Milestone Comments

Record concise, externally reviewable evidence and choices here. Do not store
private chain-of-thought, prompts, credentials, secrets, or scratchpad text.

## D-001: Separate human semantics from provider serialization

Status: Accepted

### Evidence

- The current `renderMilestone` builds one Markdown string for all providers.
- Jira then converts each Markdown source line into an unformatted ADF text
  paragraph, so headings, bullets, and links are not provider-native.
- Visibility, ordering, effect keys, and durable acknowledgements already exist
  outside the renderer and do not need redesign.

### Options

1. Keep one shared Markdown template and improve its wording.
2. Put all wording directly in each provider branch.
3. Build one bounded semantic view and serialize it with three pure provider
   renderers.

### Chosen approach

Use option 3 in a non-public `tracker-comments` module. It gives all providers
the same meaning while allowing GitHub/Linear Markdown and native Jira ADF.

### Trade-offs and risks

The extra view type and serializers add code, but prevent provider formatting
rules from contaminating synchronization logic. Table tests will lock the
shared semantics and each payload independently.

### Verification

Assert the same projection produces equivalent headline, work label, summary,
action, and evidence across GitHub, Linear, and Jira payloads.

## D-002: Use provider-specific exact markers with legacy recognition

Status: Accepted

### Evidence

- The existing visible Markdown marker carries the exact comment effect key and
  is the only lost-response reconciliation signal currently read back.
- GitHub reliably returns HTML comments in raw Markdown, Linear reconciliation
  reads raw Markdown but should not depend on hidden HTML retention, and Jira
  accepts both ADF link marks and comment properties.
- The effect key already binds provider target, feature, revision, receipt
  digest, and effect kind; changing it would strand pending acknowledgements.

### Options

1. Keep the same visible marker link on every provider.
2. Hide the marker everywhere using one HTML syntax.
3. Preserve the effect key and encode it through a hidden GitHub line, subdued
   Linear footer link, and Jira ADF link/property while recognizing the exact
   old marker.

### Chosen approach

Use option 3. Exact new and legacy representations are accepted only as whole
provider-owned structures. Partial, duplicated, or malformed expected-key
evidence fails closed.

### Trade-offs and risks

Linear and Jira retain a small `Managed by Empirical` footer because relying on
invisible markup could make recovery provider-version-dependent. The digest is
only in the link target/property, not visible status prose. Compatibility scans
are more complex and therefore receive lost-response and adversarial tests for
all providers.

### Verification

Simulate lost responses using new and legacy payloads for each provider; assert
one exact match is acknowledged, no POST follows, and duplicate/malformed
evidence remains pending with a bounded failure.

## D-003: Canonicalize untrusted text before provider escaping

Status: Accepted

### Evidence

- Projection summaries and blockers originate in workflow messages and can
  contain arbitrary punctuation, Markdown, mention-like text, or secrets.
- Markdown escaping does not protect Jira because Jira uses structured ADF, and
  ADF structure alone does not bound or redact content.
- Existing `safeText` already establishes token and credential redaction rules.

### Options

1. Trust projection schemas and interpolate their strings.
2. Strip all punctuation and markup-like characters.
3. Apply shared one-line normalization, redaction, anti-mention/anti-marker
   handling, and bounds, then apply provider-specific escaping or structure.

### Chosen approach

Use option 3. Preserve readable punctuation while neutralizing controls,
mentions, marker injection, raw digests, and secret patterns. Markdown fields
are escaped; ADF fields are inserted only as text nodes.

### Trade-offs and risks

Mention signs in user-controlled text become a visually similar non-notifying
character, which is intentionally not byte preserving in generated comments.
Tests will cover deterministic bounds and the exact retained meaning.

### Verification

Run adversarial values through every serializer and assert they cannot create a
heading, link, mention, HTML comment, alternate marker, secret, or unbounded
payload.

## D-004: Show evidence only when it is useful in the comment

Status: Accepted

### Evidence

- The current renderer exposes repository paths and receipt IDs even when the
  provider cannot produce a comment-safe link.
- Artifact upload/link effects already have independent durable keys and
  tracker-health reporting.
- Artifact media type is validated and can supply a friendly label without
  revealing its path.

### Options

1. Keep paths and receipt IDs for every artifact.
2. Omit evidence from all comments.
3. Show friendly media-derived links only for safe durable URLs and leave
   unavailable/native-upload state to artifact effects and health.

### Chosen approach

Use option 3. Duplicate labels are numbered deterministically; raw paths,
receipt IDs, and pending/unsupported prose are never serialized.

### Trade-offs and risks

A Jira attachment uploaded after the comment is not named inside that comment,
but it remains present on the ticket and truthfully tracked by the existing
artifact effect. This preserves ordering and avoids claiming an upload before
it succeeds.

### Verification

Assert safe HTTPS artifacts render as friendly links, unsafe/no-URL artifacts
render nothing, and existing artifact acknowledgement/retry tests still pass.
