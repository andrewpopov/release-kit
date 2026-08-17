/**
 * The `ReleaseKitConfig` seam. Every rouge-coupled detail the extraction
 * survey flagged (product name, paths, kinds, hygiene classification lists,
 * title/intro wording, version-strategy, manifest adapter) lives here; the
 * mechanics in the other modules are generic.
 */

import path from 'node:path';
import type { BumpLevel, VersionStrategy } from './version';
import type { VersionManifestAdapter } from './manifest';
import type { ReleaseNotesTarget } from './notes-target';

export interface ReleaseKindDef {
  id: string;
  heading: string;
  /**
   * Semantic weight of this kind. Omit to fall back to the conventional
   * default for the id (see DEFAULT_KIND_BUMP in version.ts).
   */
  bump?: BumpLevel;
}

export interface HygieneConfig {
  /** Default git ref diffed against, e.g. `origin/master`. */
  baseRef: string;
  /**
   * Explicit, opt-in escape hatch for a consumer whose CI genuinely cannot
   * supply a resolvable `baseRef` (e.g. a checkout that structurally cannot
   * fetch more history). When `true`, `checkReleaseHygiene` downgrades ONLY
   * a `base-ref-not-found` or `insufficient-history` failure — the two
   * shapes documented on `HygieneGitFailureKind` as "a bad/unfetched ref" and
   * "a shallow checkout with no shared history" — to a working-tree-only
   * check instead of failing closed, and reports the reduced coverage via
   * `HygieneResult.warnings` — LOUDLY, not silently. Defaults to
   * `false`/unset; MUST NOT be treated as the default for a shallow-checkout
   * problem — the fix for that is `fetch-depth: 0` (or fetching the base
   * ref), not this flag. Every OTHER `merge-base` failure — `git-unavailable`,
   * `not-a-git-repo`, and `git-command-failed` (a hung/killed/timed-out git
   * process, repo corruption, or any other failure that isn't cleanly one of
   * the two rescuable shapes) — is NEVER downgraded, deliberately: an
   * unrecognized git failure fails closed regardless of this setting
   * (PKG-140 finding C).
   */
  allowMissingHistory?: boolean;
  /** Path prefixes (relative, POSIX-style) that are always release-relevant. */
  relevantPrefixes: string[];
  /** Exact relative file paths that are always release-relevant. */
  relevantFiles: string[];
  /** Path prefixes under which every file counts as release tooling. */
  relevantScriptPrefixes: string[];
  /** Exact relative doc file paths that are release-process docs. */
  relevantDocFiles: string[];
  /**
   * Glob patterns (see `matchesHygieneExcludePattern` in `hygiene.ts`) for
   * paths that never require a patch note even when they fall under a
   * `relevantPrefixes`/`relevantScriptPrefixes` match — e.g. a test-only
   * change under `src/`. Applies ONLY to the prefix-based checks, never to
   * `relevantFiles`/`relevantDocFiles`: those are exact paths a repo curated
   * on purpose, an explicit opt-in that should win over a default exclusion.
   * Optional and defaults to `DEFAULT_HYGIENE_EXCLUDE_PATTERNS` (test files)
   * when omitted, so existing configs are unaffected. Set to `[]` to disable
   * exclusion entirely.
   */
  excludePatterns?: string[];
  /** Example `release-kit note ...` invocation shown in the hygiene failure help text. */
  noteCommandHelp: string;
  /** Example publish command shown in the hygiene failure help text. */
  publishCommandHelp: string;
}

export interface ReleaseKitPaths {
  /** Relative (POSIX-style) path to the patch-notes directory, e.g. `docs/patch-notes`. */
  notesDir: string;
  /** Relative (POSIX-style) path to the patch-notes index file, e.g. `docs/PATCH_NOTES.md`. */
  indexPath: string;
  /**
   * Optional relative path (resolved against `rootDir`) to the announce-once
   * ledger `announceReleaseToDiscord` uses to avoid re-posting a release. See
   * `resolveAnnouncementStatePath` in `announced.ts` for the full resolution
   * order this participates in.
   */
  announcementStateFile?: string;
}

export interface ReleaseKitConfig {
  /** User-facing product name, e.g. `"Angel Snack"`. */
  productName: string;
  stage: 'alpha' | 'beta' | 'stable';
  /** Absolute or process-relative root directory of the host repo. */
  rootDir: string;
  paths: ReleaseKitPaths;
  /** Ordered list of valid fragment kinds; render groups fragments in this order. */
  kinds: ReleaseKindDef[];
  versionStrategy: VersionStrategy;
  manifest: VersionManifestAdapter;
  hygiene: HygieneConfig;
  /**
   * Release-note title line template. MUST contain exactly one `{version}`
   * placeholder and MAY contain `{productName}`. Drives both the renderer
   * (fills the placeholders) and the parser (a regex-escaped, `{version}`-as-
   * capture-group pattern), so rendering and parsing can never drift apart.
   * Example: `"# {productName} {version} Patch Notes"`.
   */
  titleTemplate: string;
  /** Label for the current version in error messages, e.g. `"Game version"`. */
  versionLabel: string;
  /** Label for the current version in the patch-notes index, e.g. `"Current game version"`. */
  currentVersionLabel: string;
  /** Placeholder body text written into a freshly created fragment. */
  fragmentBodyPlaceholder: string;
  /**
   * Intro paragraph for a rendered release note. May reference `{notesDir}`.
   */
  releaseNoteIntroTemplate: string;
  /**
   * Intro paragraph for the patch-notes index. May reference `{notesDir}`
   * and `{publishCommand}`.
   */
  indexIntroTemplate: string;
  /**
   * Where publish/validate write and check release notes. Defaults to
   * `patchNotesDirTarget()` (rouge's per-version `releases/<version>.md` +
   * `PATCH_NOTES.md` index) when omitted — existing configs are unaffected.
   */
  notesTarget?: ReleaseNotesTarget;
}

/** Identity helper for type inference/IDE support when authoring a config file. */
export function defineConfig(config: ReleaseKitConfig): ReleaseKitConfig {
  return config;
}

export interface ResolvedPaths {
  rootDir: string;
  notesDir: string;
  unreleasedDir: string;
  releasesDir: string;
  archiveDir: string;
  indexPath: string;
}

/** Resolves a config's logical paths against its (possibly relative) `rootDir`. */
export function resolvePaths(config: ReleaseKitConfig): ResolvedPaths {
  const rootDir = path.resolve(config.rootDir);
  const notesDir = path.join(rootDir, config.paths.notesDir);
  return {
    rootDir,
    notesDir,
    unreleasedDir: path.join(notesDir, 'unreleased'),
    releasesDir: path.join(notesDir, 'releases'),
    archiveDir: path.join(notesDir, 'archive'),
    indexPath: path.join(rootDir, config.paths.indexPath),
  };
}

/** POSIX-style join of the configured `notesDir` with extra path segments. */
export function notesDirPosix(config: ReleaseKitConfig, ...segments: string[]): string {
  return [config.paths.notesDir, ...segments].join('/');
}

/**
 * POSIX-style path to the archive directory, derived from `resolvePaths`'s
 * `archiveDir` (rather than re-hardcoding the `'archive'` segment here) so a
 * repo that reconfigures the archive location stays consistent.
 */
export function archiveDirPosix(config: ReleaseKitConfig): string {
  const { notesDir, archiveDir } = resolvePaths(config);
  const archiveSegment = path.relative(notesDir, archiveDir).split(path.sep).join('/');
  return notesDirPosix(config, archiveSegment);
}

/**
 * Relative link (POSIX-style) from the patch-notes index file's directory to
 * a release file, e.g. `patch-notes/releases/0.1.0-alpha.3.md` when the
 * index lives at `docs/PATCH_NOTES.md` and the release lives under
 * `docs/patch-notes/releases/`.
 */
export function releaseLinkPath(config: ReleaseKitConfig, releaseFileName: string): string {
  const indexDir = path.posix.dirname(config.paths.indexPath);
  const releaseTarget = notesDirPosix(config, 'releases', releaseFileName);
  return path.posix.relative(indexDir, releaseTarget);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Fills `{productName}`/`{version}` placeholders in `titleTemplate`. */
export function renderTitle(config: ReleaseKitConfig, version: string): string {
  return config.titleTemplate.replace('{productName}', config.productName).replace('{version}', version);
}

/**
 * Builds a START-anchored (`^`, multiline) regex from `titleTemplate` with
 * `{version}` as a `[^\s]+` capture group — the single source shared by the
 * renderer and the parser so they can never drift apart. Intentionally NOT
 * end-anchored: this matches the upstream (rouge) title regex, which accepts
 * trailing text after the suffix, so already-published notes keep parsing.
 */
export function titleRegExp(config: ReleaseKitConfig): RegExp {
  const withProduct = config.titleTemplate.replace('{productName}', config.productName);
  const parts = withProduct.split('{version}');
  if (parts.length !== 2) {
    throw new Error('titleTemplate must contain exactly one {version} placeholder.');
  }
  return new RegExp(`^${escapeRegExp(parts[0])}([^\\s]+)${escapeRegExp(parts[1])}`, 'm');
}

/** Minimal `{key}` substitution used for the intro-text templates. */
export function applyTemplate(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (acc, [key, value]) => acc.split(`{${key}}`).join(value),
    template,
  );
}
