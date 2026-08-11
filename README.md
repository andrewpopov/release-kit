# @andrewpopov/release-kit

A reusable release/patch-note toolkit for Node.js projects. You describe
each change as a small markdown fragment with front-matter; release-kit
compiles the fragments into versioned release notes, bumps the version,
maintains an index, and enforces via a release-hygiene check that
release-relevant code changes ship with a patch-note artifact. The package
owns the **mechanics**; each consuming project supplies its own **policy**
(paths, valid kinds, wording, version strategy, version-manifest adapter)
via a small `ReleaseKitConfig`. It has **zero runtime dependencies**:
front-matter parsing and semver math are hand-rolled.

Extracted from the release tooling of
[rouge](https://github.com/andrewpopov/rouge), a game project whose scripts
(`scripts/lib/release-notes-core.js`, `cut-release.js`,
`check-release-hygiene.js`, `release-notes.js`) this package generalizes —
see `docs/ops/REUSABLE_VERSIONING_SYSTEM.md` in that repo for the design
rationale.

## Install

This package is distributed via GitHub tags (not npm):

```bash
npm install github:andrewpopov/release-kit#v0.1.4
```

## Quick start

Add a `docs/patch-notes/unreleased/*.md` fragment convention to your repo,
then write a `release-kit.config.js` at your repo root:

```js
// release-kit.config.js
const { defineConfig, stableSemver, npmPackage } = require('@andrewpopov/release-kit');

module.exports = defineConfig({
  productName: 'My Product',
  stage: 'stable',
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
  versionStrategy: stableSemver({ versionLabel: 'Product version' }),
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
release-kit hygiene [--base origin/main] [--allow-missing-history]  # fail if release-relevant changes lack a patch note
```

Common flags: `--root <dir>`, `--version <v>`, `--date <YYYY-MM-DD>`,
`--commit <sha>`, `--kind`/`--slug`/`--summary` (for `note`), `--base` /
`--allow-missing-history` (for `hygiene`), `--force`, `--allow-empty`,
`--help`.

## Release hygiene fails CLOSED on a git failure

`hygiene` computes the changed-file set from git. If it can't — the `git`
binary is missing, the directory isn't a git repository, the configured
`baseRef` doesn't resolve, or there isn't enough history to compute a diff
against it (the classic shallow-CI-checkout shape: most providers default to
a shallow clone) — the gate throws instead of silently reporting "no changes
detected". A gate that reports success when it couldn't run is worse than no
gate; treating an empty diff as "no changes" would make broken git
indistinguishable from a genuinely clean tree.

Each failure throws a `HygieneGitError` with a `kind` and an actionable
`message` naming the fix:

| `kind` | Meaning | Fix |
| --- | --- | --- |
| `git-unavailable` | `git` isn't on PATH | Install git / add it to PATH |
| `not-a-git-repo` | The directory has no `.git` history | Run from a real git checkout |
| `base-ref-not-found` | `baseRef` doesn't resolve (bad name, or never fetched into this checkout) | Verify the ref, or fetch it — a shallow CI checkout usually fetches only the current branch |
| `insufficient-history` | Both refs exist but share no common commit in this checkout | Fetch full history, e.g. `actions/checkout` with `fetch-depth: 0`, or `git fetch --unshallow` |

**This is a behavior change**: a `release:hygiene` run that used to silently
pass with an unreachable `baseRef` (checking nothing) now fails the build.
The fix in almost every case is `fetch-depth: 0` (or fetching the base ref)
in CI. If a consumer's CI genuinely cannot supply more history, set
`hygiene.allowMissingHistory: true` in `release-kit.config.js` (or pass
`--allow-missing-history`) — this is an **explicit, opt-in** escape hatch,
never the default: it downgrades a `base-ref-not-found` or
`insufficient-history` failure to a working-tree-only check and prints a loud
warning naming the reduced coverage, rather than failing or passing silently.
It does NOT rescue `git-unavailable`/`not-a-git-repo` — those checkouts can't
compute any diff at all, base-ref or otherwise.

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

The happy-path write order (bump → publish → validate) matches the original
rouge tooling. `cutRelease` is **transactional**: it snapshots every file the
cut can touch — the manifest and the notes target's output plus the
fragments it archives — before the first write, and rolls all of them back,
byte-for-byte, if bump, publish, archive, or the final validation fails.
Archived fragments are moved back to their original `unreleased/` location on
rollback, not merely copied. A rollback failure is appended to (never
replaces) the error that triggered it, so a broken rollback can't hide the
real problem. Both built-in `VersionManifestAdapter`/`ReleaseNotesTarget`
implementations support this; a custom adapter/target that doesn't implement
the optional `snapshot` method is skipped — the rest of the cut still rolls
back, just not that piece.

## Notes targets

Where a cut writes its notes is a pluggable seam. `config.notesTarget` selects
one; it defaults to `patchNotesDirTarget()` — the per-version
`releases/<version>.md` + `PATCH_NOTES.md` index model described above.

For a project that keeps a single flat `CHANGELOG.md` (for example one gated by
a CI `release-guard` that greps `^## <version>`), use `changelogTarget()`:

```js
const {
  defineConfig, stableSemver, npmPackage, changelogTarget,
} = require('@andrewpopov/release-kit');

module.exports = defineConfig({
  // ...productName, rootDir, kinds, hygiene, etc.
  paths: { notesDir: '.changes', indexPath: '.changes/INDEX.md' },
  versionStrategy: stableSemver(),
  manifest: npmPackage(),
  notesTarget: changelogTarget(),
  // changelogTarget({ changelogPath?: 'CHANGELOG.md', title?: 'Changelog', groupByKind?: false })
});
```

`cut` bumps the manifest, compiles `{notesDir}/unreleased/*.md` into a new
`## <version>` section prepended above the existing version sections (and below
any non-version preamble), archives the consumed fragments, and validates that
the `## <version>` heading is present. The new section is spliced in without
rewriting unrelated parts of the file; `indexPath` is unused by this target.

Both targets satisfy the same `ReleaseNotesTarget` interface (`publish`,
`validate`, `hasVersion`, and an optional `snapshot` for cut-rollback
support), so the `bump → publish → validate` cut flow is identical regardless
of output format. Write your own target to render release notes anywhere
else; implement `snapshot` too if you want `cutRelease` to roll it back on
failure.

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

`alphaSemver({ versionLabel? })` supports `X.Y.Z-alpha.N` and increments only
`N`. `stableSemver({ versionLabel? })` supports `X.Y.Z`; automatic bumps
increment the patch component, while `bump --version` and `cut --version`
accept an explicit stable version for major or minor releases.

### `VersionManifestAdapter`

```ts
interface VersionManifestAdapter {
  readVersion(rootDir: string): string;
  writeVersion(rootDir: string, version: string): void;
  validateVersionSync?(rootDir: string, version: string): string[];
  snapshot?(rootDir: string): () => void;
}
```

`npmPackage({ packageFileName?, lockFileName? })` reads/writes
`package.json` (+ `package-lock.json` `packages[""].version` when present —
OPTIONAL-lockfile mode: a missing lockfile is not an error, so non-npm
consumers aren't blocked). It shape-validates a present lockfile BEFORE
writing `package.json`, so a malformed lockfile fails before either file is
touched, and it implements `snapshot` so `cutRelease` can roll a failed cut's
manifest changes back byte-for-byte.

## Reusable API

```ts
import {
  defineConfig, alphaSemver, stableSemver, npmPackage,
  parseFragment, collectFragments, writeNewFragment,
  renderReleaseNote, renderPatchNotesIndex, parseReleaseSummary,
  summarizeReleaseWork,
  generateAiReleaseSummary, announceReleaseToDiscord,
  createAnthropicReleaseSummaryGenerator,
  resolveVersion, nextVersion, bumpVersion,
  publishRelease, validateReleaseState, cutRelease, listReleaseSummaries,
  classifyReleaseHygiene, checkReleaseHygiene, collectChangedFiles,
  HygieneGitError,
  runCli,
} from '@andrewpopov/release-kit';
```

### Structured release-work summary

`summarizeReleaseWork(config, fragments)` turns the same validated fragments
used to render a release note into transport-neutral data. It preserves the
configured release-kind order, omits empty kinds, and normalizes each
fragment body exactly as the markdown renderer does. This lets a dashboard,
notification, or API describe the work in a release without parsing markdown.

```ts
const fragments = collectFragments(config);
const work = summarizeReleaseWork(config, fragments);
// { itemCount, groups: [{ kind, heading, items: [{ summary, description, fileName }] }] }
```

### AI summary and Discord announcement

Release-kit includes a zero-dependency Anthropic Messages API adapter and also
accepts any compatible injected AI generator. Capture fragments before
`cutRelease` consumes them, cut and validate the release, then announce it.
The webhook is called only after the explicit release step succeeds.

```ts
const fragments = collectFragments(config);
const result = cutRelease(config);
const generate = createAnthropicReleaseSummaryGenerator();

await announceReleaseToDiscord({
  config,
  version: result.version,
  fragments,
  webhookUrl: process.env.DISCORD_RELEASE_WEBHOOK,
  releaseUrl: `https://example.com/releases/${result.version}`,
  generate,
});
```

Set `ANTHROPIC_API_KEY` in the release process's secret environment. The
Anthropic adapter defaults to `claude-haiku-4-5`; pass `{ model }` or
`{ maxTokens }` when creating it to override those defaults. It calls the
Messages API directly with no runtime SDK dependency.

The announcement contains the AI-written overview plus release items grouped
under the configured headings. Discord limits are enforced, release-item text
is marked as untrusted in the model prompt, and webhook URLs must be HTTPS
Discord webhook endpoints. Keep the webhook and model credential in the
consumer's secret store; they do not belong in `ReleaseKitConfig`.

Most functions are deterministic and filesystem-light (given fragments +
an injected date/commit), which makes them easy to test in temporary
directories — see `src/__tests__/` in this repo for examples, including a
golden-parity test that diffs this package's output against rouge's real,
unmodified scripts.

## Scope

The source project's Discord bot, public patch-notes site generator, and
deploy-counter scripts remain product-specific. Release-kit owns only the
transport-neutral AI request, an optional Anthropic transport, Discord webhook
payload, and posting mechanics; consumers keep credentials, release URLs, and
orchestration.

## Known limitations & planned hardening

v0.1.0 started as a deliberately **strict-parity** extraction — it
reproduced the original rouge tooling's behavior exactly (proven by a
byte-diff golden test against rouge's real, unmodified scripts), including a
few rough edges that were faithfully preserved rather than "fixed"
mid-extraction. `cutRelease`'s transactional rollback and hygiene's
fail-closed git handling (both documented above) have since closed the two
biggest of those. What remains:

- **Optional-lockfile mode can mask a typo'd `lockFileName`** — a configured
  lockfile path that doesn't exist is silently skipped. → a `requireLockfile`
  option.
- **Release-note metadata labels are format-fixed** (`Release date:`,
  `Stage:`, `Package version:`, and the `# {productName} Patch Notes` index
  heading). Configurable when a consumer needs different wording.

## License

MIT © Andrew Popov
## Verify locally

```bash
npm ci
npm run verify
```

## Project policies

See [Contributing](./CONTRIBUTING.md), [Support](./SUPPORT.md), and the
[Security Policy](./SECURITY.md). This package is licensed under [MIT](./LICENSE).
