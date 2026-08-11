# Plan: Explicit Bootstrap And Repository Activation

## 1. Refactor the skill and artifact registries

Files:

- `src/operations.ts`
- `src/integrations.ts`
- `src/agent-catalog.ts` only if report metadata requires clarification
- `src/types.ts` only if integration artifact reports need a compatible shape

Work:

- Replace the sole registered global skill with `empirical-init`.
- Split the generated setup-only bootstrap body from the full repository
  workflow body.
- Render multiple marker-owned files per global skill, including Codex
  explicit-only metadata, without hard-coded filesystem counts.
- Separate current global, current local, obsolete-global, and obsolete-local
  names so global update removes old `empirical` while project repair creates
  current local `empirical`.
- Preserve selection, shared-root, symlink, non-file, containment, atomic-write,
  uninstall, and unmanaged-collision guarantees.

Criteria: AC-1, AC-2, AC-5, AC-7.

## 2. Restore safe repository-local automatic activation

Files:

- `src/integrations.ts`
- `tests/integrations.test.ts`
- `tests/core.test.ts`

Work:

- Restore marker-aware merges into `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md`
  with a compact valid-config/mutation/read-only dispatcher.
- Write the detailed workflow to `.agents/skills/empirical/SKILL.md` and
  `.claude/skills/empirical/SKILL.md`.
- Remove marker-owned old native command/workflow fallbacks while preserving
  unmanaged targets and malformed-marker files.
- Keep `.mcp.json`, Cursor MCP, Gemini MCP, and Codex MCP behavior unchanged.
- Prove new initialization and populated 0.22 repair create no feature state,
  preserve stored settings/history/custom context, and converge on repeat.

Criteria: AC-2, AC-3, AC-4, AC-5, AC-6.

## 3. Update public lifecycle messaging and integration tests

Files:

- `src/cli.ts`
- `tests/integrations.test.ts`
- `tests/agent-catalog.test.ts` if derived report assertions change
- `scripts/smoke-mcp.ts`
- `scripts/test-package.ts`

Work:

- Report native `$empirical-init`, `/empirical-init`, and corresponding verified
  syntaxes while avoiding claims for skill-only targets.
- Update install/update/uninstall help and migration guidance.
- Derive created/removed counts from the actual artifact registry.
- Verify migration from old managed global `empirical`, explicit-only metadata,
  project artifact repair, clean package use, and ownership-safe uninstall.

Criteria: AC-1, AC-6, AC-7, AC-10.

## 4. Establish changelog and versioning policy

Files:

- `CHANGELOG.md`
- `docs/versioning.md`
- `package.json`
- `src/protocol.ts`
- `scripts/check-consistency.ts`
- version-sensitive tests and scripts

Work:

- Prepare canonical product version 0.23.0 while retaining Schema 5.
- Add Keep a Changelog structure with Unreleased, prepared 0.23.0 migration,
  and tag-grounded concise historical entries and compare links.
- Define alpha SemVer classification, canonical source, change workflow,
  preparation checklist, and publication boundary.
- Include changelog and versioning documentation in the npm package.
- Extend consistency and clean-consumer checks for version, heading/link,
  package contents, and the sole `empirical-init` global registry entry.

Criteria: AC-8, AC-9, AC-10.

## 5. Reconcile documentation and repository knowledge

Files:

- `README.md`
- `docs/architecture.md`
- `docs/demo.md`
- `docs/mcp.md`
- `docs/protocol.md`
- `docs/security.md`
- other consistency-scanned documentation only where stale claims exist
- `.empirical/context/*.md` during the required Context phase

Work:

- Describe the one-time Init bootstrap and ordinary prompt experience.
- Document the 0.22 per-repository repair and distinguish valid automatic
  activation from missing/invalid configuration.
- Remove normal global `/empirical` guidance while retaining private MCP/API
  operation documentation.
- Document local artifact ownership, progressive disclosure, explicit-only
  metadata limits, and unchanged safety gates.
- Refresh repository context after source changes and remove every reported
  stale/refinement-required topic.

Criteria: AC-4, AC-6, AC-7, AC-8, AC-9.

## 6. Verify, review, and integrate independently

Commands/evidence:

- focused integration and consistency suites while iterating;
- `bun run check`;
- `bun run test`;
- `bun run test:coverage`;
- `bun run test:dist`;
- `bun run test:package`;
- `bun run test:consistency`;
- `git diff --check`;
- immutable command and review receipts covering every criterion.

Work:

- Inspect the complete diff for ownership, routing, migration, version, package,
  and documentation regressions.
- Confirm no tag, release, registry publication, tracker creation, or protected
  delivery occurred.
- Replay capability deltas into a clean independent target worktree, rerun the
  integration validation, archive accepted deltas, and report the highest
  proven completion level.

Criteria: AC-1 through AC-10.
