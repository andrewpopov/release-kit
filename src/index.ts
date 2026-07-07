// Shorthand re-exports (no renaming) so cjs-module-lexer statically detects
// the named exports for ESM consumers of the CommonJS build.

export { defineConfig, resolvePaths, notesDirPosix, releaseLinkPath, renderTitle, titleRegExp, applyTemplate } from './config';
export type { ReleaseKitConfig, ReleaseKitPaths, ReleaseKindDef, HygieneConfig, ResolvedPaths } from './config';

export { alphaSemver, ALPHA_VERSION_RE } from './version';
export type { VersionStrategy, AlphaSemverOptions } from './version';

export { npmPackage } from './manifest';
export type { VersionManifestAdapter, NpmPackageOptions } from './manifest';

export {
  parseFrontMatter,
  slugify,
  todayIso,
  isFragmentFile,
  parseFragment,
  collectFragments,
  normalizeFragmentBody,
  writeNewFragment,
} from './fragments';
export type { Fragment, ParsedFrontMatter, WriteNewFragmentOptions } from './fragments';

export { renderReleaseNote, parseReleaseSummary, renderPatchNotesIndex } from './render';
export type { ReleaseSummary, RenderReleaseNoteOptions } from './render';

export {
  resolveVersion,
  nextVersion,
  getGitShortSha,
  bumpVersion,
  listReleaseSummaries,
  updatePatchNotesIndex,
  publishRelease,
  validateReleaseState,
  cutRelease,
} from './publish';
export type {
  BumpVersionOptions,
  BumpVersionResult,
  PublishReleaseOptions,
  PublishReleaseResult,
  ValidateReleaseStateResult,
  CutReleaseOptions,
  CutReleaseResult,
} from './publish';

export {
  classifyReleaseHygiene,
  collectChangedFiles,
  checkReleaseHygiene,
  isPatchNoteArtifact,
  isReleaseRelevantFile,
} from './hygiene';
export type { HygieneResult, CheckReleaseHygieneOptions } from './hygiene';

export { run as runCli, parseArgs as parseCliArgs } from './cli';
export type { CliRunOptions } from './cli';
