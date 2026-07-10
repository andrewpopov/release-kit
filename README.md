# @andrewpopov/release-kit

A reusable release/patch-note toolkit for Node.js projects. You describe
each change as a small markdown fragment with front-matter; release-kit
compiles the fragments into versioned release notes, bumps the version,
maintains an index, and enforces via a release-hygiene check that
release-relevant code changes ship with a patch-note artifact. The package
owns the **mechanics**; each consuming project supplies its own **policy**
(paths, valid kinds, wording, version strategy, version-manifest adapter)
via a small `ReleaseKitConfig`. It has **zero runtime dependencies**:
front-matter parsing and alpha-semver math are hand-rolled.

Extracted from the release tooling of
[rouge](https://github.com/andrewpopov/rouge), a game project whose scripts
(`scripts/lib/release-notes-core.js`, `cut-release.js`,
`check-release-hygiene.js`, `release-notes.js`) this package generalizes —
see `docs/ops/REUSABLE_VERSIONING_SYSTEM.md` in that repo for the design
rationale.

## Install

This package is distributed via GitHub tags (not npm):

```bash
npm install github:andrewpopov/release-kit#v0.1.0
```

## Quick start

Add a `docs/patch-notes/unreleased/*.md` fragment convention to your repo,
then write a `release-kit.config.js` at your repo root:

```js
// release-kit.config.js
const { defineConfig, alphaSemver, npmPackage } = require('@andrewpopov/release-kit');

module.exports = defineConfig({
  productName: 'My Product',
  stage: 'alpha',
  rootDir: __dirname,
  paths: {
    notesDir: 'docs/patch-notes',
    indexPath: 'docs/PATCH_NOTES.md',
  },
  kinds: [
    { id: 'highlight', heading: 'Highlights' },
    { id: 'feature', heading: 'Features' },
    { id: 'fix', heading: 'Fixes' },
    { id: 'ops', heading: 'Operations' },
  ],
  versionStrategy: alphaSemver({ versionLabel: 'Product version' }),
  manifest: npmPackage(),
  hygiene: {
    baseRef: 'origin/main',
    relevantPrefixes: ['src/', 'prisma/'],
    relevantFiles: ['package.json', 'package-lock.json'],
    relevantScriptPrefixes: ['scripts/release-'],
    relevantDocFiles: ['docs/PATCH_NOTES.md'],
    noteCommandHelp: 'npm run release:note -- --kind feature --slug short-slug --summary "User-facing summary"',
    publishCommandHelp: 'npm run release:publish',
  },
  titleTemplate: '# {productName} {version} Patch Notes',
  versionLabel: 'Product version',
  currentVersionLabel: 'Current product version',
  fragmentBodyPlaceholder: 'Describe the user-facing impact in one short paragraph before publishing.',
  releaseNoteIntroTemplate: 'These notes are gathered from the release fragments in `{notesDir}/unreleased/`.',
  indexIntroTemplate: 'Patch notes are gathered from `{notesDir}/unreleased/*.md` and published with `{publishCommand}`.',
});
```

Wire repo scripts around the CLI:

```json
{
  "scripts": {
    "release:note": "release-kit note",
    "release:notes": "release-kit notes",
    "release:bump": "release-kit bump",
    "release:publish": "release-kit publish",
    "release:cut": "release-kit cut",
    "release:check": "release-kit check",
    "release:hygiene": "release-kit hygiene"
  }
}
```

## CLI

Seven verbs:

```bash
release-kit note --kind feature --slug town-flow --summary "Town flow polish"
release-kit notes                              # preview the current-version release note
release-kit bump [--version 0.2.0-alpha.0]     # bump the manifest version
release-kit publish [--force] [--allow-empty]  # publish fragments into a release file
release-kit cut [--force] [--allow-empty]      # bump + publish + validate in one step
release-kit check                              # validate the current release state
release-kit hygiene [--base origin/main]       # fail if release-relevant changes lack a patch note
```

Common flags: `--root <dir>`, `--version <v>`, `--date <YYYY-MM-DD>`,
`--commit <sha>`, `--kind`/`--slug`/`--summary` (for `note`), `--base` (for
`hygiene`), `--force`, `--allow-empty`, `--help`.

## Fragment format

```markdown
---
kind: feature
summary: Town flow polish
---

Improved reward pacing after elite fights so the next choice is easier to scan.
```

`kind` must be one of `config.kinds[].id`. Fragments live under
`{notesDir}/unreleased/*.md` (any `.md` file except `README.md` and files
starting with `_`).

## Release artifacts

```text
docs/
  PATCH_NOTES.md
  patch-notes/
    unreleased/
      feature-town-flow.md
    releases/
      0.1.0-alpha.1.md
    archive/
      0.1.0-alpha.1/
        feature-town-flow.md
```

`cut` bumps the manifest version, publishes `unreleased/*.md` into
`releases/<version>.md`, copies the consumed fragments into
`archive/<version>/`, deletes them from `unreleased/`, refreshes the index,
and validates the result.

**v0.1.0 is a STRICT-PARITY port of the original rouge tooling**: the cut
order (bump → publish → validate) has no transactional rollback — a
mid-publish throw can leave the manifest bumped with fragments partially
archived. Snapshot/rollback hardening is planned for a v0.1.1 release and
will not change the happy-path output.

## The config seam (`ReleaseKitConfig`)

Every product-specific detail (product name, paths, valid kinds, hygiene
classification lists, title/intro wording, version strategy, manifest
adapter) is config. The mechanics — fragment parsing, rendering, publish
ordering, git-diff collection — are generic.

The release-note **title line** is a single template string (e.g.
`"# {productName} {version} Patch Notes"`) that drives BOTH the renderer and
the historical-file parser (via a regex built from the same template), so
they can never drift apart — the test suite proves a package configured
with `productName: "Angel Snack"` parses rouge's real historical release
files unchanged.

### `VersionStrategy`

```ts
interface VersionStrategy {
  assert(version: string): void;
  next(version: string): string;
  compareDesc(a: ReleaseSummary, b: ReleaseSummary): number;
  releaseFileName(version: string): string;
}
```

`alphaSemver({ versionLabel? })` ships in v0.1.0 (`X.Y.Z-alpha.N`, bump only
`N`). A `stableSemver` (real major/minor/patch) strategy is a natural
addition for a non-alpha consumer, added when one exists — not built
speculatively.

### `VersionManifestAdapter`

```ts
interface VersionManifestAdapter {
  readVersion(rootDir: string): string;
  writeVersion(rootDir: string, version: string): void;
  validateVersionSync?(rootDir: string, version: string): string[];
}
```

`npmPackage({ packageFileName?, lockFileName? })` reads/writes
`package.json` (+ `package-lock.json` `packages[""].version` when present —
OPTIONAL-lockfile mode: a missing lockfile is not an error, so non-npm
consumers aren't blocked).

## Reusable API

```ts
import {
  defineConfig, alphaSemver, npmPackage,
  parseFragment, collectFragments, writeNewFragment,
  renderReleaseNote, renderPatchNotesIndex, parseReleaseSummary,
  resolveVersion, nextVersion, bumpVersion,
  publishRelease, validateReleaseState, cutRelease, listReleaseSummaries,
  classifyReleaseHygiene, checkReleaseHygiene, collectChangedFiles,
  runCli,
} from '@andrewpopov/release-kit';
```

Most functions are deterministic and filesystem-light (given fragments +
an injected date/commit), which makes them easy to test in temporary
directories — see `src/__tests__/` in this repo for examples, including a
golden-parity test that diffs this package's output against rouge's real,
unmodified scripts.

## Scope (v0.1.0)

Everything the three original release scripts do EXCEPT a Discord notifier
(`release-kit announce discord ...`), which is planned for v0.2.0 after cut
behavior is stable elsewhere. The source project's Discord bot, public
patch-notes site generator, and deploy-counter scripts are product-specific
and were deliberately not extracted.

## Known limitations & planned hardening (v0.1.x)

v0.1.0 is a deliberately **strict-parity** extraction — it reproduces the
original tooling's behavior exactly (proven by a byte-diff golden test
against rouge's real, unmodified scripts), including a few rough edges that
are faithfully preserved rather than "fixed" mid-extraction. These are
slated for a hardening pass that will not change happy-path output:

- **Non-transactional cut** — a mid-publish failure can leave a half-bumped
  state (inherited). → snapshot/rollback.
- **`bump --version <v>` does not validate** the explicit version against the
  strategy (inherited), so an out-of-scheme value can be written. → assert.
- **Optional-lockfile mode can mask a typo'd `lockFileName`** — a configured
  lockfile path that doesn't exist is silently skipped. → a `requireLockfile`
  option.
- **Hygiene swallows git/base-ref failures** (inherited): an unreachable
  `baseRef` (e.g. a shallow CI checkout) yields an empty changed-file set and
  can pass falsely. → surface base-ref resolution errors.
- **Release-note metadata labels are format-fixed** (`Release date:`,
  `Stage:`, `Package version:`, and the `# {productName} Patch Notes` index
  heading). Configurable when a consumer needs different wording.

## License

MIT © Andrew Popov
