<!-- empirical-sdd:start -->
## Empirical repository workflow

When `.empirical/config.json` has `schemaVersion: 5` and
`setupComplete: true`, automatically use the repository-local Empirical
workflow for requests to build, add, implement, change, fix, refactor, remove,
migrate, upgrade, change tests, or continue repository work. The user does not
need to mention Empirical. Read-only explanation and inspection stay outside
the workflow.

Read `.agents/skills/empirical/SKILL.md` (or the native project copy) for the
full contract. Use Empirical MCP operations first and private
`empirical __internal` fallbacks only when MCP is unavailable. If the config
is missing, invalid, or incomplete, do not initialize implicitly; tell the user
to invoke `empirical-init` explicitly.
<!-- empirical-sdd:end -->
