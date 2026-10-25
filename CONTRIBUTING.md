# Contributing

Small, independently reviewable changes are welcome. Discuss changes to the trust model or agent protocol before widening access or adding providers.

## Local checks

Use Node.js 24+ and run:

```text
npm ci
npm run format
npm run verify
```

On Windows with Chrome installed, also run `npm run browser:test` for UI, HTTP, TLS or process-control changes. The browser suite starts an isolated service and does not issue inference requests. `ORBIT_CHROME_PATH` selects another Chrome-compatible executable.

Never use personal chat transcripts, local workspace screenshots or production device tokens as fixtures. Generate synthetic data, and keep runtime files outside the repository. `check:publication` examines files tracked by Git; stage intended source files before running it.

## Atomic commits

- Give each commit one reason to exist: a feature, a fix, tests for that change, or documentation for a distinct behavior.
- Keep directly dependent code and meaningful tests in the same commit.
- Use short imperative Conventional Commit subjects, for example `feat: show remaining agent quotas` or `fix: reject expired pairing codes`.
- Keep formatting-only changes separate from behavior changes when modifying existing code.
- Do not commit dependencies, generated protocol schemas, logs, databases, CA keys or personal account data.

Describe the resulting behavior and relevant validation in the pull request. Note protocol/version assumptions and user-visible limitations. No cloud deployment is required to test this project.

## Dependency changes

Commit `package.json` and `package-lock.json` together. Run `npm audit --omit=dev` and the affected tests. Third-party SDKs retain their own licences and provider terms; the project licence covers Orbit's own source.
