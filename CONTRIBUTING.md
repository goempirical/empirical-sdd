# Contributing

Keep the core product-neutral and preserve non-destructive adoption of existing
`ai/` repositories. Agent-specific files are generated discovery adapters; they
must never contain workflow state or business logic. Any protocol change needs
a migration note and conformance test. Fast must remain materially shorter than
Complex while both retain evidence and review gates.

Changes to living specifications must preserve strict delta validation, atomic
Archive rollback, and idempotent retry. Worktree isolation changes must keep
feature-local state/event paths compatible, bind mutations explicitly, and test shared-resource
concurrency. Project policy may add context but must never become an enforcement
override. OpenSpec can be used for development planning, but it must not become a
runtime or published-package dependency.

Before opening a pull request:

```bash
bun install
bun run check
bun test
bun run test:dist
bun run test:package
npm pack --dry-run
```

The published package must run on Node.js 22+ even though Bun powers local
development. Do not add a required database, hosted service, or MCP vendor to
the canonical state path. New integrations call the exported TypeScript API.

## Publishing to npm

Publishing is performed only by `.github/workflows/publish.yml` after a
non-prerelease GitHub Release is published. Before creating the release:

1. Merge a pull request that sets the exact version in `package.json` and
   `src/protocol.ts` and passes CI.
2. Create a GitHub Release whose tag is exactly `v<version>` and points to a
   commit on `main`.
3. Approve the protected `npm` GitHub environment when prompted.

The npm trusted publisher must be bound to organization `goempirical`,
repository `empirical-sdd`, workflow `publish.yml`, environment `npm`, and the
`npm publish` action. The release workflow uses OIDC and must not receive a
long-lived npm write token.

If a release run fails before `npm publish`, keep the immutable tag and GitHub
Release unchanged. After merging the repair, retry `publish.yml` manually with
that exact existing tag. The workflow repeats every version, ancestry, and npm
existence check before publishing.
