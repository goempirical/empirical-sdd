# Live Sanitized Push Verification

- Completed at: `2026-08-19T14:12:36Z`
- Repository remote: configured `origin` (credential-redacted)
- Probe ref: `refs/heads/probe/empirical-auth-push-evidence-20260819`
- Runtime: `spawnSync` with `shell: false`, `PATH`, and
  `githubAuthenticationEnvironment(["git", "push", ...])`
- Operation: exact `git push --dry-run`; no remote mutation requested
- Exit: `0`
- Probe ref before: absent
- Probe ref after: absent

Persistent Git configuration was hashed by scope immediately before and after
the dry run and remained byte-stable:

- Local: `418819f07058525d434093bc8a2c97362f7f3c8cbe9e736a4fb61704debeebb2`
- Global: `ac5c4ce81013a220cf6212761771e8c5efea5e8f556391de98c0e483abc693fb`
- System: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`

The command output contained only the bounded pass/fail result. No token,
credential value, configuration path value, repository URL, or user home path
is retained in this artifact.
