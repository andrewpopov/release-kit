// Shorthand re-exports (no renaming) so cjs-module-lexer statically detects
// the named exports for ESM consumers of the CommonJS build.

export { defineConfig, resolvePaths, notesDirPosix, releaseLinkPath, renderTitle, titleRegExp, applyTemplate } from './config';
export type { ReleaseKitConfig, ReleaseKitPaths, ReleaseKindDef, HygieneConfig, ResolvedPaths } from './config';

export { alphaSemver, stableSemver, ALPHA_VERSION_RE, STABLE_VERSION_RE } from './version';
export type { VersionStrategy, AlphaSemverOptions, StableSemverOptions } from './version';

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

export { patchNotesDirTarget, changelogTarget } from './notes-target';
export type { ReleaseNotesTarget, ReleaseNotesPublishContext, ChangelogTargetOptions } from './notes-target';

export { summarizeReleaseWork } from './work-summary';
export type { ReleaseWorkItem, ReleaseWorkGroup, ReleaseWorkSummary } from './work-summary';

export {
  buildAiReleaseSummaryPrompt,
  generateAiReleaseSummary,
  buildDiscordReleasePayload,
  postReleaseToDiscord,
  announceReleaseToDiscord,
} from './announcement';
export type {
  AiReleaseSummaryRequest,
  AiReleaseSummaryGenerator,
  GenerateAiReleaseSummaryOptions,
  DiscordEmbedField,
  DiscordReleasePayload,
  BuildDiscordReleasePayloadOptions,
  DiscordFetchResponse,
  DiscordFetch,
  PostReleaseToDiscordOptions,
  AnnounceReleaseToDiscordOptions,
  ReleaseAnnouncementResult,
} from './announcement';

export { createAnthropicReleaseSummaryGenerator } from './anthropic';
export type {
  AnthropicFetchResponse,
  AnthropicFetch,
  AnthropicReleaseSummaryOptions,
} from './anthropic';

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
  createReleaseArtifactV1,
} from './publish';
export type {
  BumpVersionOptions,
  BumpVersionResult,
  PublishReleaseOptions,
  PublishReleaseResult,
  ValidateReleaseStateResult,
  CutReleaseOptions,
  CutReleaseResult,
  ReleaseArtifactV1,
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
