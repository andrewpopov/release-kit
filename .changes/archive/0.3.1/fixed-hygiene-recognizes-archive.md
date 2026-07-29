---
kind: fixed
summary: release:hygiene now recognizes archived fragments, so a release branch can pass
---

`release:cut` relocates consumed fragments from `.changes/unreleased/` to
`.changes/archive/<version>/`, but `isPatchNoteArtifact` recognized only
`unreleased/` and `releases/`. A branch that cut a release therefore had no
artifact hygiene would accept — and with `changelogTarget()` (a flat
`CHANGELOG.md`, no per-version file under `releases/`) there was none it could
ever accept, so `release:hygiene` failed on every release branch. It now also
accepts the archive directory, derived from the configured `archiveDir` rather
than a second hardcoded `'archive'`. Found when auth-kit became the first repo
to cut a release with release-kit.
