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

## Unreleased

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
