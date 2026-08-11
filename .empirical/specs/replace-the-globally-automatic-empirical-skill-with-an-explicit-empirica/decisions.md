# Decisions: Explicit Bootstrap And Repository Activation

Record concise, externally reviewable evidence and choices here. Do not store
private chain-of-thought, prompts, credentials, secrets, or scratchpad text.

## D-001: Scope automatic activation to initialized repositories

Status: Accepted

### Evidence

- Codex, Claude Code, Cursor, and Gemini support repository-scoped Agent Skills;
  the verified runtime set also supports project instruction files.
- A global skill matcher cannot know whether `.empirical` exists until it has
  already selected and loaded the global skill.
- Empirical previously generated marker-owned project skills and instruction
  blocks successfully; release 0.22 removed them by product choice.

### Options

1. Keep the global automatic skill and ask it to inspect every repository.
2. Use only project MCP server instructions.
3. Install one explicit global bootstrap, then generate a short repository
   dispatcher plus progressively disclosed local workflow skill.

### Chosen approach

Choose option 3. Repository configuration and committed integration artifacts
become the activation boundary, while the only global workflow skill is Init.

### Trade-offs and risks

Existing 0.22 repositories need one repair invocation and some hosts make skill
selection probabilistic. The short always-on dispatcher closes that gap for the
verified runtimes without injecting the full workflow into every prompt.

### Verification

Assert automatic mutation routing, read-only exclusion, invalid/missing config
exclusion, native project discovery paths, and one-time repair behavior.

## D-002: Keep the detailed workflow as a local skill

Status: Accepted

### Evidence

- The complete current workflow contract includes setup-independent routing,
  discovery, tracker, evidence, context, integration, and safety instructions.
- Repeating that full body in three always-loaded instruction files consumes
  unnecessary context and increases drift risk.
- Agent Skills provide progressive disclosure from metadata to the full body.

### Options

1. Put the full workflow in every project instruction file.
2. Rely only on implicit skill-description matching.
3. Keep a short deterministic dispatcher and one shared local workflow body,
   with a native Claude copy where `.agents/skills` is not its project path.

### Chosen approach

Choose option 3. `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md` carry the small
activation boundary; `.agents/skills/empirical` and `.claude/skills/empirical`
carry the complete behavior.

### Trade-offs and risks

The local skill remains visible in some selectors even though users never need
to invoke it. Documentation calls Init the only explicit entrypoint, while the
local skill is described as an internal automatic workflow contract.

### Verification

Generated-content tests assert identical workflow semantics, correct dispatcher
references, byte convergence, and no documented normal `/empirical` ceremony.

## D-003: Make Init explicitly non-implicit where hosts allow it

Status: Accepted

### Evidence

- Codex supports `policy.allow_implicit_invocation: false` in
  `agents/openai.yaml`.
- Claude Code supports `disable-model-invocation: true` skill frontmatter.
- Invocation-policy metadata is not standardized across every catalog target.

### Options

1. Depend only on a narrow description.
2. Add host-specific controls only in separate installers.
3. Bundle safe optional metadata with the portable narrow description.

### Chosen approach

Choose option 3. The global skill artifact registry writes `SKILL.md` plus
marker-owned Codex metadata; Claude frontmatter is present in the portable file.

### Trade-offs and risks

Some hosts may ignore unknown metadata and still use model matching. The Init
description has an intentionally narrow setup/repair scope and reports do not
promise unsupported invocation behavior.

### Verification

Inspect isolated global installations for both metadata controls, exact native
Init invocations, and safe multi-file uninstall/reconciliation.

## D-004: Use an explicit per-repository repair migration

Status: Accepted

### Evidence

- Global update knows selected agent homes but has no safe inventory of a
  developer's repositories.
- Searching arbitrary filesystem roots would exceed lifecycle scope and create
  privacy, performance, and destructive-selection risks.
- Existing initialization already applies only explicitly supplied settings and
  safely refreshes project integrations.

### Options

1. Scan the filesystem during `empirical update`.
2. Retain the global automatic skill indefinitely as a migration bridge.
3. Require one explicit Init repair for each existing 0.22 repository.

### Chosen approach

Choose option 3 and make the migration visible in help, README, changelog, and
Init's repair report.

### Trade-offs and risks

An old repository remains without automatic activation until repaired. This is
an intentional fail-closed boundary and avoids hidden writes or permanent global
prompt interception.

### Verification

Repair a populated 0.22 fixture and prove only managed integrations/context
metadata change while feature history, configuration, and custom context remain.

## D-005: Adopt alpha SemVer plus Keep a Changelog

Status: Accepted

### Evidence

- The repository has immutable tags for 0.20.2, 0.20.3, 0.20.4, and 0.22.0 but
  no root changelog or explicit version selection policy.
- Replacing the global entrypoint is user-visible and requires migration.
- The package remains below 1.0 and explicitly describes itself as alpha.

### Options

1. Treat every change as a patch until 1.0.
2. Jump directly to 1.0.0.
3. Use PATCH for compatible fixes, MINOR for additive or breaking alpha public
   changes, and reserve 1.0.0 for a declared stable contract.

### Chosen approach

Choose option 3 and prepare 0.23.0. Track observable changes using Keep a
Changelog categories and tag-backed comparisons rather than raw commit logs.

### Trade-offs and risks

SemVer permits breaking changes during 0.y.z but consumers can still miss them.
Every breaking alpha minor therefore requires an explicit migration note. A
consistency check prevents silent version and changelog drift.

### Verification

Assert 0.23.0 across canonical surfaces, validate changelog headings/links and
package contents, retain Schema 5, and verify no tag or publication is created.
