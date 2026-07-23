/**
 * Publish/validate flow — ported byte-for-byte from rouge's
 * `scripts/lib/release-notes-core.js`. STRICT PARITY for v0.1.0: this
 * replicates rouge's exact current write order (release file -> archive
 * copies -> delete unreleased -> refresh index) with NO transactional
 * rollback. That hardening is deferred to v0.1.1 (see the extraction plan).
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { ReleaseKitConfig } from './config';
import { resolvePaths } from './config';
import type { Fragment } from './fragments';
import { collectFragments, todayIso } from './fragments';
import type { ReleaseSummary } from './render';
import { parseReleaseSummary, renderPatchNotesIndex } from './render';
import type { ReleaseNotesTarget } from './notes-target';
import { patchNotesDirTarget } from './notes-target';

export { collectFragments } from './fragments';

export function tryStep<T>(errors: string[], fn: () => T, fallback: T, prefix = ''): T {
  try {
    return fn();
  } catch (error) {
    errors.push(`${prefix}${error instanceof Error ? error.message : String(error)}`);
    return fallback;
  }
}

/** Resolves the config's notes target, defaulting to `patchNotesDirTarget()` (rouge's current behavior). */
export function resolveNotesTarget(config: ReleaseKitConfig): ReleaseNotesTarget {
  return config.notesTarget ?? patchNotesDirTarget();
}

/** Returns `explicitVersion` trimmed, or the manifest's current version. */
export function resolveVersion(config: ReleaseKitConfig, explicitVersion?: string): string {
  const rootDir = path.resolve(config.rootDir);
  return String(explicitVersion || config.manifest.readVersion(rootDir)).trim();
}

/** Returns `explicitVersion` trimmed, or the strategy's next version after the manifest's current version. */
export function nextVersion(config: ReleaseKitConfig, explicitVersion?: string): string {
  const previousVersion = resolveVersion(config);
  return String(explicitVersion || config.versionStrategy.next(previousVersion)).trim();
}

/** Shells out to `git rev-parse --short HEAD`; returns `""` if unavailable. */
export function getGitShortSha(rootDir: string): string {
  try {
    return String(
      execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
        cwd: rootDir,
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5000,
      }),
    ).trim();
  } catch {
    return '';
  }
}

export interface BumpVersionOptions {
  version?: string;
}

export interface BumpVersionResult {
  previousVersion: string;
  version: string;
}

export function bumpVersion(config: ReleaseKitConfig, options: BumpVersionOptions = {}): BumpVersionResult {
  const rootDir = path.resolve(config.rootDir);
  const previousVersion = config.manifest.readVersion(rootDir);
  const version = String(options.version || config.versionStrategy.next(previousVersion)).trim();
  config.versionStrategy.assert(version);
  config.manifest.writeVersion(rootDir, version);
  return { previousVersion, version };
}

export function listReleaseSummaries(config: ReleaseKitConfig): ReleaseSummary[] {
  const { releasesDir } = resolvePaths(config);
  if (!fs.existsSync(releasesDir)) {
    return [];
  }
  return fs
    .readdirSync(releasesDir)
    .filter((fileName) => fileName.endsWith('.md') && fileName !== 'README.md')
    .sort((left, right) => left.localeCompare(right))
    .map((fileName) => parseReleaseSummary(config, path.join(releasesDir, fileName)))
    .sort((left, right) => config.versionStrategy.compareDesc(left, right));
}

export function updatePatchNotesIndex(config: ReleaseKitConfig, version: string): void {
  const { indexPath } = resolvePaths(config);
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.writeFileSync(indexPath, renderPatchNotesIndex(config, listReleaseSummaries(config), version), 'utf8');
}

export interface PublishReleaseOptions {
  version?: string;
  date?: string;
  commit?: string;
  force?: boolean;
  allowEmpty?: boolean;
}

export interface PublishReleaseResult {
  version: string;
  releasePath: string;
  fragmentCount: number;
}

export interface ReleaseArtifactV1 {
  schemaVersion: 1; product: string; repository: string; version: string; commit: string; date: string;
  renderedNotes: string; notesDigest: string; artifactRef: string; fragmentCount: number;
}

/** Build a deterministic, transport-neutral descriptor only after validation succeeds. */
export function createReleaseArtifactV1(config: ReleaseKitConfig, result: PublishReleaseResult, commit = ''): ReleaseArtifactV1 {
  const validation = validateReleaseState(config, result.version);
  if (!validation.ok) throw new Error(`Release ${result.version} is not validated: ${validation.errors.join('; ')}`);
  const rootDir = path.resolve(config.rootDir);
  const renderedNotes = fs.readFileSync(result.releasePath, 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')) as { name?: string; repository?: string | { url?: string } };
  const repository = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url ?? rootDir;
  return Object.freeze({ schemaVersion: 1, product: manifest.name ?? path.basename(rootDir), repository, version: result.version,
    commit: commit || getGitShortSha(rootDir), date: parseReleaseSummary(config, result.releasePath).date, renderedNotes,
    notesDigest: createHash('sha256').update(renderedNotes).digest('hex'), artifactRef: path.relative(rootDir, result.releasePath), fragmentCount: result.fragmentCount });
}

export function publishRelease(config: ReleaseKitConfig, options: PublishReleaseOptions = {}): PublishReleaseResult {
  const version = resolveVersion(config, options.version);
  const date = options.date || todayIso();
  config.versionStrategy.assert(version);
  const paths = resolvePaths(config);
  fs.mkdirSync(paths.archiveDir, { recursive: true });
  fs.mkdirSync(paths.unreleasedDir, { recursive: true });
  const fragments: Fragment[] = collectFragments(config);
  if (fragments.length === 0 && !options.allowEmpty) {
    throw new Error('No unreleased patch-note fragments found. Use --allow-empty to publish an empty note.');
  }
  const { releasePath } = resolveNotesTarget(config).publish(
    config,
    { version, date, commit: String(options.commit || ''), fragments },
    { force: options.force },
  );
  return { version, releasePath, fragmentCount: fragments.length };
}

export interface ValidateReleaseStateResult {
  ok: boolean;
  errors: string[];
  version: string;
}

export function validateReleaseState(config: ReleaseKitConfig, explicitVersion = ''): ValidateReleaseStateResult {
  const errors: string[] = [];
  const rootDir = path.resolve(config.rootDir);
  const version = tryStep(errors, () => resolveVersion(config, explicitVersion), '');
  if (version) {
    tryStep(errors, () => config.versionStrategy.assert(version), undefined);
    if (config.manifest.validateVersionSync) {
      const manifestErrors = tryStep(errors, () => config.manifest.validateVersionSync!(rootDir, version), []);
      errors.push(...manifestErrors);
    }
  }
  tryStep(errors, () => collectFragments(config), []);
  errors.push(...resolveNotesTarget(config).validate(config, version));
  return { ok: errors.length === 0, errors, version };
}

export interface CutReleaseOptions {
  version?: string;
  date?: string;
  commit?: string;
  force?: boolean;
  allowEmpty?: boolean;
}

export interface CutReleaseResult {
  previousVersion: string;
  version: string;
  fragmentCount: number;
  releasePath: string;
}

/**
 * Asserts the version shape, the empty-fragments guard, and the "notes
 * already exist" guard BEFORE the manifest is bumped — so re-cutting an
 * existing version without `--force` fails clean, leaving package.json
 * untouched, instead of bumping first and only then throwing inside
 * `publishRelease`/`ReleaseNotesTarget.publish`. That target-specific publish
 * check is kept too (defense in depth against direct `publishRelease` calls
 * that bypass `cutRelease`).
 */
function preflightCut(config: ReleaseKitConfig, targetVersion: string, options: CutReleaseOptions): { fragmentCount: number } {
  config.versionStrategy.assert(targetVersion);
  if (resolveNotesTarget(config).hasVersion(config, targetVersion) && !options.force) {
    throw new Error(`Release notes for ${targetVersion} already exist. Re-run with force to overwrite.`);
  }
  const fragments = collectFragments(config);
  if (fragments.length === 0 && !options.allowEmpty) {
    throw new Error('No unreleased patch-note fragments found. Add fragments or pass --allow-empty.');
  }
  return { fragmentCount: fragments.length };
}

/**
 * Bumps the manifest to the next (or explicit) version, publishes fragments
 * into a versioned release file, and validates the result — rouge's exact
 * current order (bump -> publish -> validate), matching `cut-release.js`.
 */
export function cutRelease(config: ReleaseKitConfig, options: CutReleaseOptions = {}): CutReleaseResult {
  const previousVersion = resolveVersion(config);
  const version = String(options.version || config.versionStrategy.next(previousVersion)).trim();
  const preflight = preflightCut(config, version, options);
  bumpVersion(config, { version });
  const release = publishRelease(config, {
    version,
    date: options.date,
    commit: options.commit,
    force: options.force,
    allowEmpty: options.allowEmpty,
  });
  const validation = validateReleaseState(config, version);
  if (!validation.ok) {
    throw new Error(`Release ${version} was cut but failed validation:\n${validation.errors.join('\n')}`);
  }
  return {
    previousVersion,
    version,
    fragmentCount: preflight.fragmentCount,
    releasePath: release.releasePath,
  };
}
