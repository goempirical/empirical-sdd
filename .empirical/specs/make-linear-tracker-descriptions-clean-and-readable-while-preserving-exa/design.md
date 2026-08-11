# Design: Readable Linear tracker descriptions

## Overview

Keep GitHub and Jira formatting unchanged. Introduce a Linear-only Markdown
representation whose visible labels are concise while exact machine markers
remain in URL fragments. Linear parsing recognizes both the new representation
and the one legacy HTML form already emitted by Empirical.

## Representation

The managed projection is bounded by two Markdown links. Their labels are
readable; their fragment targets contain the exact feature start/end markers.
Between them, a compact summary carries phase, workflow status, revision, and
completion. The create recovery reference is one Markdown link whose label is
human-facing and whose fragment carries the exact feature and attempt digest.

## Migration and ownership

Linear upsert classifies projection and recovery markers before mutation. One
balanced new pair is replaced in place. One balanced legacy pair is migrated in
place. A legacy recovery block is migrated while preserving its original digest,
including when the issue is later attached from a fresh local project. Mixed,
duplicate, malformed, or unbalanced ownership raises the existing marker
ambiguity error before any remote update. Content outside the exact span is
preserved byte-for-byte except for existing boundary whitespace normalization.

## Recovery

Linear create and reconciliation use an exact Linear-specific marker predicate.
The predicate accepts only one marker for the requested attempt key, whether it
is the legacy block or the new link. Provider search continues to use the full
persisted idempotency key contained in the Markdown destination, so the durable
prepared/dispatched protocol and no-second-create rule are unchanged.

## Verification

Add request-body assertions for clean visible text and exact hidden markers;
legacy projection/recovery migration coverage; ambiguity coverage; and retain
all existing lost-response cases. Run TypeScript, focused tracker tests, the full
CI gate, then migrate and inspect SDD-5 with a fresh secret supplied through BB's
secure secret flow.
