# Replace The Global Automatic Skill With Repository Activation

## Request

> Replace the globally automatic empirical skill with an explicit empirical-init bootstrap skill. After initialization, repositories containing valid .empirical state must automatically route ordinary repository-changing prompts through Empirical without requiring the user to type empirical, while read-only prompts and repositories without .empirical remain unaffected. Restore safe marker-owned repository-local activation for supported agents and preserve project MCP bridges. Migrate existing managed global skills safely, document the one-time repair required for existing repositories, add CHANGELOG.md and an explicit Semantic Versioning and changelog policy, and prepare version 0.23.0 consistently without publishing or releasing it.

## Goal

Make Empirical disappear from the normal prompting ceremony after a single,
explicit repository bootstrap. Developers initialize or repair a repository
through one `empirical-init` agent skill; committed repository-local guidance
then activates the full workflow automatically for ordinary change requests
only in valid Empirical repositories. At the same time, establish a durable
SemVer and human-readable changelog discipline and prepare the breaking alpha
minor as `0.23.0` without publishing it.

## Acceptance Criteria

- [ ] [AC-1] `empirical install` and `empirical update` reconcile exactly one
  global workflow skill named `empirical-init` for every selected agent,
  remove only marker-owned global `empirical` copies from prior releases, and
  preserve unmanaged files, directories, symbolic links, shared roots, and
  remembered agent selection.
- [ ] [AC-2] The generated `empirical-init` contract is limited to first setup
  and repair: it performs the existing setup review, initializes or repairs
  configuration, repository context, MCP bridges, and automatic activation,
  creates no feature workflow state, and stops with an exact repair report.
- [ ] [AC-3] Codex, Claude Code, Cursor, Gemini CLI, and Windsurf receive safe,
  marker-owned repository-local activation through their supported project
  instruction/skill surfaces. Repeated initialization converges byte-for-byte,
  unmatched markers and unmanaged collisions are preserved and reported, and
  no initialization writes outside the repository.
- [ ] [AC-4] In an initialized repository, an ordinary build, add, implement,
  change, fix, refactor, remove, migrate, upgrade, test-changing, or continue
  request is routed through the local Empirical workflow without naming a
  skill. Read-only explanation or inspection remains outside the state machine,
  and a repository without valid `.empirical/config.json` is not implicitly
  enrolled.
- [ ] [AC-5] Repository-local activation retains the complete current contract:
  selected non-terminal work wins, vague ideas use five-pass discovery,
  concrete work routes conservatively to Fast or Complex, bounded autonomy and
  tracker behavior remain available, evidence and context gates remain exact,
  and publication or external handoff still requires explicit authorization.
- [ ] [AC-6] Existing Schema-5 repositories from `0.22.x` have a documented,
  ownership-safe one-time repair path through `empirical-init`; initialization
  installs missing local activation without changing stored configuration or
  historical feature state unless the user explicitly changes a setup value.
- [ ] [AC-7] Public help, README, architecture, MCP guidance, generated reports,
  package smoke tests, and clean-consumer tests present `empirical-init` as the
  only explicit agent workflow entrypoint and do not instruct users to invoke
  `empirical` for normal work.
- [ ] [AC-8] A root `CHANGELOG.md` follows Keep a Changelog categories, contains
  an Unreleased section and dated historical entries grounded in repository
  tags, and is included in the npm package. A versioning document defines
  Semantic Versioning rules for the alpha package, the canonical version
  source, release checklist, changelog update requirement, and the separation
  between version preparation and publication.
- [ ] [AC-9] Package metadata, runtime constants, help/version output, generated
  context, distribution checks, and version-sensitive tests consistently use
  `0.23.0`; Schema 5 remains unchanged and no tag, release, registry publish,
  remote ticket, or protected delivery action occurs.
- [ ] [AC-10] Type checking, unit/integration tests, coverage gates, built MCP
  smoke tests, packed-consumer verification, consistency checks, and
  `git diff --check` all pass with regression coverage for global migration,
  local activation, repair idempotence, collision preservation, and changelog
  packaging.

## Scope

- Replace the registered global `empirical` skill with `empirical-init`.
- Split the current generated contract into a setup-only global bootstrap and
  a repository-local automatic workflow contract.
- Restore marker-safe managed project guidance and skills for the five runtime
  integrations with verified invocation/reload metadata while retaining all
  current project MCP configuration.
- Reconcile old managed global and local artifacts without touching unmanaged
  user configuration.
- Update living capability contracts, documentation, tests, package contents,
  version constants, and repository knowledge for version `0.23.0`.
- Add `CHANGELOG.md` and `docs/versioning.md` based on Keep a Changelog 1.1.0
  and Semantic Versioning 2.0.0.

## Non-goals

- Automatically scanning a developer's filesystem to locate and repair every
  existing repository during package update.
- Treating the mere presence of an arbitrary `.empirical` directory as valid
  configuration without schema and setup validation.
- Routing read-only questions, status explanations, or general conversation
  through a new feature workflow.
- Promising automatic activation for catalog targets whose project instruction
  or skill behavior is not verified; global bootstrap installation remains
  available but unverified capabilities stay labeled honestly.
- Changing Schema 5 workflow semantics, weakening evidence or safety gates,
  launching another agent, delivering protected branches, tagging, releasing,
  or publishing `0.23.0`.

## Risks

- Project-local instructions consume host context and can conflict with
  user-owned files; keep the always-loaded dispatcher short, the detailed skill
  progressively disclosed, and every mutation marker- and path-safe.
- Skill relevance is probabilistic on some hosts; combine repository-scoped
  skills with native always-on instruction surfaces for the verified runtimes.
- Removing the global automatic skill creates a bootstrap gap for existing
  repositories; document and test one explicit repair invocation per checkout.
- Agent-specific invocation controls are not portable. Use explicit-only host
  metadata where supported and a narrowly scoped Init description everywhere.
- A manual version bump can drift across package, runtime, docs, and tests;
  extend the consistency gate to make the canonical version and changelog
  contract machine-verifiable.

## Verification

- Install and refresh in isolated homes for all catalog targets; assert only
  `empirical-init`, exact verified native invocations, shared-root
  deduplication, safe removal of managed `empirical`, and preservation of
  unmanaged collisions and unsafe paths.
- Initialize and repair temporary repositories containing empty files,
  user-authored instructions, managed old blocks, malformed markers, and stale
  managed skills; assert exact created/updated/removed/preserved reports and
  repeat-run convergence.
- Inspect generated project activation for the verified five agents and assert
  the mutation/read-only/no-config routing boundary and the full workflow,
  tracker, evidence, context, and authorization invariants.
- Run version/help, documentation consistency, npm pack contents, clean
  consumer imports, full CI, and a changelog/version-policy validation.
- Confirm Git status contains no release tag or remote-state artifact and that
  Schema version remains 5.

## Capability Deltas

- `deltas/agent-integrations.md`
- `deltas/package-distribution.md`
