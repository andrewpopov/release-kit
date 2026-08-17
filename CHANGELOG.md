# Changelog

All notable changes to `@andrewpopov/release-kit` are documented here.

## Release-guard format

This package is released by pushing a `vX.Y.Z` git tag. A CI **release-guard**
job runs on every `v*` tag and FAILS the release unless BOTH are true:

1. The tag version (`vX.Y.Z` → `X.Y.Z`) exactly equals `version` in
   `package.json`.
2. A heading `## X.Y.Z` exists in this file.

So every release MUST: bump `package.json`, add a matching `## X.Y.Z` heading
below with the changes, commit, then tag `vX.Y.Z`. Do not tag ahead of the
CHANGELOG entry.

---

## 0.6.0

- ReleaseArtifactV1's renderedNotes/date are now scoped to the released version, not the whole notes target
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
- hygiene now fails closed instead of silently passing when git or the base ref is unavailable
  `release-kit hygiene` used to swallow every git failure and treat it as "no changed files," so an invalid or unreachable `baseRef` — including the shallow checkout that most CI providers use by default — made the gate report success having checked nothing. It now throws a `HygieneGitError` (exported, with a `kind`: `git-unavailable`, `not-a-git-repo`, `base-ref-not-found`, or `insufficient-history`) whenever it can't reliably compute the changed-file set, and the CLI exits non-zero instead of printing "ok". **This will newly fail any `release:hygiene` run whose CI checkout can't resolve `hygiene.baseRef`** — most commonly a shallow clone that never fetched the base branch. Fix it by fetching full history (`actions/checkout` with `fetch-depth: 0`, or `git fetch --unshallow`/fetch the base ref explicitly); each thrown error names the fix for its specific failure. If your CI genuinely cannot supply more history, set `hygiene.allowMissingHistory: true` in `release-kit.config.js` (or pass `--allow-missing-history`) to explicitly downgrade to a working-tree-only check with a loud warning instead of failing — this is opt-in only, never the default.
- announceReleaseToDiscord gains announce-once semantics
  `announceReleaseToDiscord` now posts a given version at most once by default, tracked in a small on-disk ledger, so wiring it into deploy-kit's `deliveryEvent` hook (which fires once per deploy, not once per release) no longer re-posts the same announcement on every redeploy. New options: `announceOnce` (default `true`), `force` to post anyway, and `stateFile` to pin the ledger location. The ledger path otherwise resolves via `RELEASE_ANNOUNCE_STATE`, the new `config.paths.announcementStateFile`, `DEPLOY_KIT_SHARED_DIR`, a sibling `shared/` directory, or a non-durable fallback inside `rootDir`. The result type is now a discriminated union on `skipped`, and the new `resolveAnnouncementStatePath`/`readAnnouncedVersions`/`hasAnnouncedVersion`/`recordAnnouncedVersion` primitives are exported directly.
- artifact generation no longer reads package.json directly, so a custom manifest adapter works without one
  `createReleaseArtifactV1` unconditionally read `package.json` off `rootDir`
  for `product`/`repository`, even though `ReleaseKitConfig.manifest`
  (`VersionManifestAdapter`) is the seam every other release operation already
  goes through. A consumer with a custom, non-npm manifest adapter and no
  `package.json` at the root could cut and validate a release but crashed
  (`ENOENT`) trying to produce its `--json` artifact. `VersionManifestAdapter`
  gained an optional `readArtifactMetadata(rootDir)` method returning
  `{ product?, repository? }`; `createReleaseArtifactV1` calls it instead of
  reading `package.json`, falling back to `config.productName`/`rootDir` when
  the adapter doesn't implement it or omits a field. `npmPackage()` implements
  it with the exact same `name`/`repository` derivation
  `createReleaseArtifactV1` used to inline, so its behavior for existing npm
  consumers is unchanged.
- a failed release cut now rolls back cleanly instead of leaving the working tree half-mutated
  `cutRelease` bumped the manifest, published the release note, and archived consumed fragments before validating the result — so a validation failure (or a malformed lockfile discovered mid-write) left package.json/package-lock.json bumped, the notes target partially written, and fragments possibly moved into `archive/<version>/`, with no way back short of a manual git reset mid-release. `cutRelease` now snapshots every file a cut can touch (the manifest, via a new optional `VersionManifestAdapter.snapshot`, and the notes target's output plus its archived fragments, via a new optional `ReleaseNotesTarget.snapshot`) before the first write, and restores all of them byte-for-byte — including moving archived fragments back to `unreleased/` — if bump, publish, archive, or the final validation fails. `npmPackage()`'s manifest adapter also now validates a present lockfile's shape before writing `package.json`, so a malformed lockfile is caught before either file is touched. A rollback failure is appended to, and never masks, the original error. Both built-in adapters/targets implement the new `snapshot` hook (which now returns a `Guard: { commit(): void; restore(): string[] }` rather than a bare restore callback); a custom one that doesn't is simply skipped, so the rest of a cut still rolls back.
  
  The rollback itself is now safe to run, not just present: restoring a fragment always recreates its `unreleased/` copy BEFORE deleting the archived copy, so a failed or skipped source restore leaves the fragment in the archive rather than in neither location. Restoring a file also only overwrites it if the file's current bytes still match what release-kit itself last wrote there — a legitimate concurrent edit (another process, or a person, touching the same path after the cut wrote it but before rollback ran) is left alone and reported by name instead of being silently clobbered. And rollback now removes any directory the cut had to create along the way (e.g. a first-ever `archive/`), once it's empty, instead of leaving empty residue behind.

## 0.5.0

- hygiene no longer requires a patch note for a test-only change
  `isReleaseRelevantFile` matched on broad path prefixes (e.g. `src/`), and
  test files live under those same prefixes, so a change that added only test
  coverage was classified release-relevant and blocked at push time for a
  change no user can observe. `hygiene.excludePatterns` (default: common test
  file shapes — `__tests__/`, `__mocks__/`, `*.test.*`, `*.spec.*`) now exempts
  a genuinely test-only change; it applies only to prefix-based matches, never
  to a repo's curated exact `relevantFiles`/`relevantDocFiles` lists, and a
  change that also touches real source under the same prefix still requires a
  note. Configurable per repo, defaults to the common test-file shapes.
- hygiene rejects a trailing-period summary on changed fragments
  `release-kit hygiene` validated a changed fragment's body for the scaffold
  placeholder but never its summary, so a summary ending in `.` sailed through
  every push and only failed later, at `check`/`publish` time — the renderer
  emits `**{summary}:**`, so a trailing period renders `**Summary.:**`. hygiene
  now applies the same rule `parseFragment` already enforced, through one
  shared `validateFragmentContent` helper, scoped to only the fragments the
  current change adds or modifies. `HygieneResult` gains a
  `trailingPeriodSummaryPatchNoteFiles` field and the CLI prints the offending
  file(s) by name.

## 0.4.1

- hygiene rejects a placeholder body on changed fragments
  `release-kit hygiene` — the check consumers run in pre-push hooks — previously
  only confirmed that a patch-note fragment existed for release-relevant
  changes; it never looked at the body, so a fragment left holding the
  generated scaffold placeholder sailed through every push and only failed
  later, at `check`/`publish` time, after the code was already deployed. hygiene
  now rejects a placeholder body too, scoped to only the fragments the current
  change adds or modifies (added/modified fragments still on disk), so it never
  retroactively fails a push over pre-existing placeholder fragments elsewhere
  in the repo. `HygieneResult` gains a `placeholderPatchNoteFiles` field and the
  CLI prints the offending file(s) by name.

## 0.4.0

- check and cut reject scaffold-placeholder bodies and trailing-period summaries; parseFragment now takes the full config
  A fragment whose body was still the configured `fragmentBodyPlaceholder` passed `check` and published verbatim — a consumer repo nearly shipped 28 of 124 placeholder bodies into its release notes and Discord announcement. `parseFragment` now rejects a body equal to the scaffold placeholder and a summary ending in `.` (the renderer emits `**{summary}:**`, so a trailing period renders `**Summary.:**`). The scaffold→edit workflow is intact: `note` only writes, and `hygiene` never parses bodies. Breaking for library callers only: exported `parseFragment` now takes the full `ReleaseKitConfig` instead of `ReleaseKindDef[]` (no known direct callers; the CLI is unaffected).

## 0.3.1

- release:hygiene now recognizes archived fragments, so a release branch can pass
  `release:cut` relocates consumed fragments from `.changes/unreleased/` to
  `.changes/archive/<version>/`, but `isPatchNoteArtifact` recognized only
  `unreleased/` and `releases/`. A branch that cut a release therefore had no
  artifact hygiene would accept — and with `changelogTarget()` (a flat
  `CHANGELOG.md`, no per-version file under `releases/`) there was none it could
  ever accept, so `release:hygiene` failed on every release branch. It now also
  accepts the archive directory, derived from the configured `archiveDir` rather
  than a second hardcoded `'archive'`. Found when auth-kit became the first repo
  to cut a release with release-kit.

## 0.3.0

- The version bump is now derived from fragment kinds, so a breaking change no longer ships as a patch
  `stableSemver().next()` incremented the patch component unconditionally, so `release:cut` labelled any batch as a patch no matter what was in it — deploy-kit shipped a breaking change as `0.14.1`. Fragment kinds are now read: a `breaking` fragment produces a major bump (a minor while pre-1.0, since `0.x` already declares an unstable API), `added` produces a minor, and anything else a patch. Declare `bump` on a `ReleaseKindDef` to weight a non-conventional kind id. An explicit `--version` still overrides everything. Two consequences for existing consumers: repos whose fragments include `added` or `breaking` will now see minor and major bumps where they previously saw patches, and a **custom** `VersionStrategy` must declare `bumpLevelSupport: 'supported' | 'ignored'` — release-kit refuses an implicit non-patch cut through a strategy that has not said whether it honours fragment kinds, rather than silently mislabeling the release.
- verifyPackedBins() and a `verify-bins` CLI verb assert every package.json#bin is executable in the packed tarball
  deploy-kit and release-kit each shipped a CLI at mode 644, giving every `github:` consumer `Permission denied`, and both repos' `verify:pack` claimed to check the bin and passed anyway. The reason is structural: `npm install` chmods a bin target to 755 on the way in, so a check that inspects an installed consumer tree — even one that spawns the installed binary — can never see the defect. Only the packed tarball carries the truth. `verifyPackedBins()` packs (or takes a pre-packed tarball), reads the stored mode of every declared `bin` target, and reports each one as missing or not-executable; `release-kit verify-bins` exposes it as a CLI. Packages that declare no `bin` pass trivially, so it drops into any repo's gate unchanged.

## 0.2.1

- Manage release-kit's own releases with release-kit (dogfooding changelogTarget)
  release-kit now cuts its own releases through its own `changelogTarget()`: describe each change as a fragment under `.changes/unreleased/` and run `npm run release:cut`. The config self-references the local build (`./dist/index.js`) since the package cannot depend on itself.
- The release-kit CLI is executable again, and stays that way across builds.
  `dist/cli.js` was committed as mode 100644, so a `github:` install linked `node_modules/.bin/release-kit` at a non-executable file and any invocation failed with `Permission denied`. The committed mode is now 100755, and `build` runs `chmod +x dist/cli.js` after `tsc` — without that, the next build would silently revert it, since `dist/` is generated and tsc writes 644.

## 0.2.0

- Add a pluggable release-notes **target** seam (`ReleaseNotesTarget`).
  `publishRelease`, `validateReleaseState`, and `cutRelease` now route
  target-specific writes and checks through `config.notesTarget`, defaulting to
  `patchNotesDirTarget()` (the per-version `releases/<version>.md` + index
  model). Existing consumers are unaffected — the default reproduces prior
  behavior, proven by the unchanged golden/parity tests.
- Add `changelogTarget()`, a flat `CHANGELOG.md` target: fragments compile into
  a `## X.Y.Z` section prepended above existing version sections (and below any
  non-version preamble), consuming fragments the same way. This is the format a
  fleet `release-guard` greps with `^## <version>`. Options: `changelogPath`
  (default `CHANGELOG.md`), `title` (default `Changelog`), `groupByKind`
  (default `false`). Publishing splices in only the new section without
  rewriting the rest of the file.
- Add `hasVersion` to `ReleaseNotesTarget` so `cutRelease` rejects an
  already-released version **before** bumping the manifest (no partial cut).
- Export `patchNotesDirTarget`, `changelogTarget`, `ReleaseNotesTarget`,
  `ReleaseNotesPublishContext`, and `ChangelogTargetOptions`.

## 0.1.4

- Add `summarizeReleaseWork`, a structured, transport-neutral view of the
  fragments included in a release for dashboards, APIs, and notifications.
- Add provider-neutral AI release summaries and validated Discord webhook
  announcements containing both the generated overview and grouped release
  work.
- Add a zero-dependency Anthropic Messages API generator that reads
  `ANTHROPIC_API_KEY` at request time and defaults to Claude Haiku 4.5.

## 0.1.3

- Add `stableSemver`, a stable `X.Y.Z` version strategy extracted from the
  Smart Home service. Automatic cuts increment patch versions; explicit
  versions continue to support deliberate major and minor releases.

## 0.1.2

- Publish `ReleaseArtifactV1` and the validation-gated JSON output introduced
  after the original v0.1.1 tag.

## 0.1.1

- Add public contribution, support, and private vulnerability-reporting policies.
- Validate explicit `bumpVersion` inputs through the configured
  `VersionStrategy` before changing a manifest.
- Add `npm run verify` for the local release gate.
- Upgrade the Vitest development toolchain to a version with no known advisories.

## 0.1.0

Initial release. Extracted from rouge's release/patch-note tooling
(`scripts/lib/release-notes-core.js`, `scripts/cut-release.js`,
`scripts/check-release-hygiene.js`, `scripts/release-notes.js`) as a
standalone, config-driven package. Verified byte-for-byte parity against
rouge's real scripts (see the package's `src/__tests__/golden.test.ts`).

### Added

- **Version strategy** (`alphaSemver`) — `X.Y.Z-alpha.N` versioning
  (`assert`/`next`/`compareDesc`/`releaseFileName`), matching rouge's exact
  current behavior. Pluggable via the `VersionStrategy` interface for a
  future `stableSemver` or other policy.
- **Manifest adapter** (`npmPackage`) — reads/writes `package.json` (+
  `package-lock.json` when present, in OPTIONAL-lockfile mode). Pluggable via
  the `VersionManifestAdapter` interface.
- **Fragments** — `parseFrontMatter`, `slugify`, `todayIso`, `parseFragment`,
  `collectFragments`, `writeNewFragment`, `normalizeFragmentBody`. Hand-rolled
  front-matter parsing (no `gray-matter`/YAML dependency), ported exactly.
- **Rendering** — `renderReleaseNote`, `renderPatchNotesIndex`,
  `parseReleaseSummary`, driven by a single `titleTemplate` string so the
  renderer and the historical-file parser can never drift apart.
- **Publish/validate** — `publishRelease`, `validateReleaseState`,
  `cutRelease`, `bumpVersion`, `listReleaseSummaries`. STRICT PARITY with
  rouge's current write order (release file → archive copies → delete
  unreleased → refresh index); no transactional rollback yet (planned for
  0.1.1).
- **Hygiene** — `classifyReleaseHygiene`, `collectChangedFiles`,
  `checkReleaseHygiene`. Classification lists (relevant prefixes/files/script
  prefixes/doc files) are 100% config-driven.
- **Config seam** (`ReleaseKitConfig` / `defineConfig`) — covers every
  rouge-coupled detail the extraction survey flagged: product name, stage,
  paths, kinds, version strategy, manifest adapter, hygiene lists + help
  text, title template, version labels, fragment placeholder, and the
  release-note/index intro text templates.
- **CLI** (`release-kit`) — 7 verbs matching rouge's npm scripts: `note`,
  `notes` (preview), `bump`, `publish`, `cut`, `check`, `hygiene`. Loads
  `release-kit.config.js`/`.cjs` from the target root.
- Zero runtime dependencies (matches rouge's tooling — front-matter parsing
  and version math are hand-rolled, not delegated to a library).
