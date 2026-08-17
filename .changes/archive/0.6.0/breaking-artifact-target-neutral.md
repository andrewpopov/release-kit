---
kind: breaking
summary: ReleaseArtifactV1's renderedNotes/date are now scoped to the released version, not the whole notes target
---

`createReleaseArtifactV1` used to build `renderedNotes`/`date` by re-reading
and re-parsing `result.releasePath` after publish already wrote it. For
`patchNotesDirTarget()` (the default) that file happens to be one version's
own note, so this worked by luck; for `changelogTarget()` — every consumer in
the fleet — `releasePath` is the entire, cumulative `CHANGELOG.md`, so the
"validated descriptor for one release" actually carried every historical
release ever written plus an empty `date` (a changelog section has no
`Release date:` line for the regex to match). `ReleaseNotesTarget.publish()`
now returns the `content`/`date` it just wrote for that release, and
`createReleaseArtifactV1` uses those directly instead of re-parsing.
**`ReleaseNotesTarget.publish()`'s return type gained two required fields
(`content`, `date`)** — a custom notes target must now return them too, or
`createReleaseArtifactV1` will build an artifact with an `undefined`
`renderedNotes`/`date` (and throw building its digest). Both built-in targets
(`patchNotesDirTarget`, `changelogTarget`) implement this.
`PublishReleaseResult`/`CutReleaseResult` also gained the same two fields,
which is additive for existing callers reading known fields off the result.
Any `changelogTarget()` consumer of `--json`/`createReleaseArtifactV1` output
will see `renderedNotes` shrink from the whole changelog to just the new
version's section, and `date` go from always-empty to correct — that is the
fix, not a regression, but it is a value-shape change worth checking any
downstream JSON consumer against.
