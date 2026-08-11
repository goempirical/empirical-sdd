# Design: Explicit Bootstrap, Automatic Repository Workflow

## Product model

Empirical has two scopes with separate responsibilities:

```text
user scope                         repository scope
┌─────────────────────┐            ┌──────────────────────────────┐
│ empirical-init      │  creates   │ .empirical/                  │
│ explicit setup only │ ─────────► │ short automatic dispatcher   │
└─────────────────────┘            │ local empirical workflow     │
                                   │ project MCP bridges          │
                                   └──────────────────────────────┘
```

`empirical install` keeps the existing selected-agent lifecycle but writes only
`empirical-init`. Init owns first setup and repair. It never interprets its
attached text as a feature, never calls Fast, Complex, Loop, Complete, tracker
binding, handoff, delivery, or publication, and stops after reporting exact
configuration, context, and integration results.

Normal repository work has no explicit command. Committed project instructions
identify a valid completed `.empirical/config.json` as the activation boundary.
They route change requests to a repository-local `empirical` workflow skill and
skip read-only questions. Repositories without valid completed configuration
remain ordinary repositories and may be enrolled only through explicit Init.

## Generated contracts

Split the current `AUTOMATIC_SKILL_BODY` into two generated bodies.

### Global bootstrap

`empirical-init/SKILL.md` contains only:

1. read-only repository and setup inspection;
2. the existing complete Apply/Keep, Customize, Cancel setup review;
3. `empirical_init` with every explicit setup value after approval;
4. repository-context refinement when missing or stale;
5. project integration repair and exact reporting;
6. a stop condition that prohibits feature state.

Use the narrow description “Explicitly initialize or repair Empirical in the
current repository; use only when the user asks for setup or repair.” Add
Claude's `disable-model-invocation: true` frontmatter and a marker-owned
`agents/openai.yaml` with `policy.allow_implicit_invocation: false`. Unknown
metadata remains inert for other Agent Skills hosts; the narrow description is
the portable fallback.

### Repository workflow

The detailed current automatic contract remains named `empirical`, but it is
written only inside initialized repositories:

```text
.agents/skills/empirical/SKILL.md
.claude/skills/empirical/SKILL.md
```

The shared `.agents` path covers Codex, Cursor, and Gemini's supported project
skill discovery. Claude receives its native project copy. Windsurf and every
verified host also receive the short instruction dispatcher and can read the
shared repository skill directly when its native project skill discovery is
not guaranteed.

Write one marker-owned dispatcher block into `AGENTS.md`, `CLAUDE.md`, and
`GEMINI.md`. It is deliberately short and always loaded:

- validate `schemaVersion: 5` and `setupComplete: true`;
- activate the local Empirical workflow for repository mutations and resume;
- skip read-only explanation/inspection;
- use the detailed local skill and MCP-first/private-fallback contract;
- never auto-initialize a missing or invalid repository.

Existing marker-aware Markdown merge behavior is restored. New files are
atomic and path-contained; a single valid block is replaced in place, no block
is appended across unmatched markers, and user bytes outside the block are
preserved. Marker-owned legacy project commands and skills are removed, while
unmanaged or symbolic targets are reported and left alone.

## Integration registry and migration

The shared skill registry changes from `empirical` to `empirical-init` while
remaining one entry. Separate artifact roles prevent a scope collision:

- current global skill: `empirical-init`;
- current repository workflow: `empirical`;
- obsolete global skills: `empirical`, Explore, Fast, Complex, Loop, Spec,
  Socratic, and YOLO;
- obsolete project entrypoints: explicit Init/Explore/Fast/Complex/Loop/Spec,
  Socratic/YOLO commands and old native command/workflow fallbacks.

Global reconciliation removes a marker-owned old `empirical/SKILL.md` only
after safely writing current Init at the selected root. Unmanaged collisions,
shared roots, selection metadata, and unrelated skills retain current
preservation semantics. Uninstall removes both current Init artifacts and any
marker-owned obsolete global Empirical artifacts.

The global artifact renderer supports multiple marker-owned files per skill:
`SKILL.md` and optional `agents/openai.yaml`. Counts and reports derive from the
rendered artifact registry instead of hard-coded totals.

No package process searches for repositories. An existing 0.22 checkout has no
local activation because that release deliberately removed it, so migration is
one explicit `empirical-init` repair per repository. Repair calls the existing
field-wise initialization path, preserving omitted configuration values,
history, evidence, active selection, and deliberately maintained context.

## Version and changelog model

`src/protocol.ts` remains the canonical product version and advances to
`0.23.0`; Schema stays 5. `package.json`, public help, smoke tests, clean
consumer checks, and repository context must agree.

Add `CHANGELOG.md` following Keep a Changelog 1.1.0. It contains an Unreleased
section, the prepared 0.23.0 compatibility change, and concise entries for the
existing tagged 0.22.0, 0.20.4, 0.20.3, and 0.20.2 releases, with tag-backed
compare links. A prepared version heading records repository preparation; it
does not claim npm publication.

Add `docs/versioning.md` with these alpha SemVer rules:

- PATCH: backward-compatible corrections;
- MINOR: additive or breaking public workflow/integration changes, with
  migration notes required for breaking behavior;
- 1.0.0: first declared stable compatibility contract.

The policy documents canonical source, change classification, changelog
categories, preparation checklist, exact remote publication gates, and the rule
that a local version bump is not delivery or publication. Both documents are
included in npm package contents.

Extend `test:consistency` to parse package metadata and changelog structure,
require the canonical version in the prepared heading, require version-policy
links, and assert the one registered global skill is `empirical-init`.

## Compatibility and safety

- Schema 5 state and every workflow operation remain compatible.
- Public terminal lifecycle remains Install, Update, and Uninstall.
- Existing MCP operation names and private CLI transport remain unchanged.
- Init retains setup confirmation and cancellation before all mutation.
- Local automatic routing does not weaken active-work ownership, evidence,
  tracker, external-agent, Git, credential, delivery, or publication gates.
- Project artifacts are committed and travel with clones; the npm executable
  must still be installed for configured MCP/private fallback commands.
- Unverified catalog targets receive the global bootstrap file but no claim of
  project-auto-activation until their repository surfaces are audited.

## Verification strategy

1. Registry and isolated-home tests prove one global Init skill, exact verified
   invocations, explicit-only Codex/Claude metadata, migration from managed
   `empirical`, shared-root behavior, selection persistence, and uninstall.
2. Project integration fixtures prove the five verified activation paths,
   exact dispatcher contract, full local workflow contract, idempotence,
   unmatched-marker failure-closed behavior, and unmanaged/symlink preservation.
3. Core initialization tests prove repair creates no feature state and preserves
   existing configuration, context, history, and active selection.
4. Documentation, help, MCP smoke, clean package, and consistency tests prove
   the command model and `0.23.0` version/changelog contract.
5. Full CI, immutable evidence receipts, independent integration, capability
   delta archival, and context refresh prove completion without publication.
