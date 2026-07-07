# Security model

`@andrewpopov/release-kit` is a build/release-tooling package: it reads and
writes files under a consumer-configured `rootDir` (patch-note fragments,
release files, `package.json`/`package-lock.json`, the patch-notes index)
and shells out to `git` (read-only: `merge-base`, `diff --name-only`,
`ls-files`, `rev-parse --short HEAD`) for hygiene classification and commit
stamping. It has **zero runtime dependencies**.

## What it does not do

- No network calls, no telemetry, no external services.
- No secrets, tokens, or credentials are read, stored, or transmitted.
- `git` is invoked with a fixed argument list built from configured
  ref/path values — no user-supplied shell strings are interpolated into a
  shell (`execFileSync` is used throughout, not `exec`/`spawn` with
  `shell: true`).
- Filesystem writes are confined to the configured `rootDir` (fragment
  files, release files, the patch-notes index, and the version manifest).
  There is no sandboxing beyond normal Node.js file-permission behavior —
  run it with the same trust level you'd give any other build/release
  script in your repo (e.g. your existing `npm run build`).

## Intended trust boundary

This package is meant to run in a developer's local environment or CI, on a
repository the operator already trusts and controls — the same trust level
as `npm run build` or any other repo-local tooling script. It is **not**
designed to process untrusted input (e.g., patch-note fragment content from
an unreviewed external contributor should be reviewed the same way any other
committed file would be before a `release-kit cut`/`publish` consumes it).

## Reporting a vulnerability

Please use [GitHub Security Advisories](https://github.com/andrewpopov/release-kit/security/advisories/new)
on this repository rather than a public issue.
