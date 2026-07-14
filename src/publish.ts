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
import type { ReleaseKitConfig } from './config';
import { releaseLinkPath, resolvePaths } from './config';
import type { Fragment } from './fragments';
import { collectFragments, todayIso } from './fragments';
import type { ReleaseSummary } from './render';
import { parseReleaseSummary, renderPatchNotesIndex, renderReleaseNote } from './render';

export { collectFragments } from './fragments';

function tryStep<T>(errors: string[], fn: () => T, fallback: T, prefix = ''): T {
  try {
    return fn();
  } catch (error) {
    errors.push(`${prefix}${error instanceof Error ? error.message : String(error)}`);
    return fallback;
  }
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

export function publishRelease(config: ReleaseKitConfig, options: PublishReleaseOptions = {}): PublishReleaseResult {
  const version = resolveVersion(config, options.version);
  const date = options.date || todayIso();
  config.versionStrategy.assert(version);
  const paths = resolvePaths(config);
  fs.mkdirSync(paths.releasesDir, { recursive: true });
  fs.mkdirSync(paths.archiveDir, { recursive: true });
  fs.mkdirSync(paths.unreleasedDir, { recursive: true });
  const fragments: Fragment[] = collectFragments(config);
  if (fragments.length === 0 && !options.allowEmpty) {
    throw new Error('No unreleased patch-note fragments found. Use --allow-empty to publish an empty note.');
  }
  const releasePath = path.join(paths.releasesDir, config.versionStrategy.releaseFileName(version));
  if (fs.existsSync(releasePath) && !options.force) {
    throw new Error(`${path.relative(paths.rootDir, releasePath)} already exists. Re-run with --force to overwrite it.`);
  }
  fs.writeFileSync(
    releasePath,
    renderReleaseNote(config, { version, date, fragments, commit: String(options.commit || '') }),
    'utf8',
  );
  if (fragments.length > 0) {
    const archiveVersionDir = path.join(paths.archiveDir, version);
    fs.mkdirSync(archiveVersionDir, { recursive: true });
    for (const fragment of fragments) {
      fs.copyFileSync(fragment.filePath, path.join(archiveVersionDir, fragment.fileName));
      fs.rmSync(fragment.filePath);
    }
  }
  updatePatchNotesIndex(config, version);
  return { version, releasePath, fragmentCount: fragments.length };
}

function validateReleaseFile(
  config: ReleaseKitConfig,
  errors: string[],
  rootDir: string,
  releasePath: string,
  expectedVersion: string,
): void {
  const release = tryStep(errors, () => parseReleaseSummary(config, releasePath), null);
  if (!release) {
    return;
  }
  const relativePath = path.relative(rootDir, releasePath);
  if (release.titleVersion !== expectedVersion) {
    errors.push(`${relativePath} title version ${release.titleVersion || '(missing)'} does not match ${expectedVersion}.`);
  }
  if (release.packageVersion !== expectedVersion) {
    errors.push(`${relativePath} package version ${release.packageVersion || '(missing)'} does not match ${expectedVersion}.`);
  }
  if (release.stage.toLowerCase() !== config.stage.toLowerCase()) {
    errors.push(`${relativePath} stage ${release.stage || '(missing)'} must be ${config.stage}.`);
  }
  if (!release.date) {
    errors.push(`${relativePath} is missing a release date.`);
  }
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
  const { releasesDir, indexPath } = resolvePaths(config);
  // Best-effort filename for path construction only; an invalid version was
  // already reported by assert() above, so this never emits a second error.
  let currentReleaseFileName = `${version}.md`;
  try {
    currentReleaseFileName = config.versionStrategy.releaseFileName(version);
  } catch {
    // reported above
  }
  const currentReleasePath = path.join(releasesDir, currentReleaseFileName);
  if (version && !fs.existsSync(currentReleasePath)) {
    errors.push(`Current version ${version} has no published patch note at ${path.relative(rootDir, currentReleasePath)}.`);
  } else if (version) {
    validateReleaseFile(config, errors, rootDir, currentReleasePath, version);
  }
  if (!fs.existsSync(indexPath)) {
    errors.push(`Missing patch-note index: ${path.relative(rootDir, indexPath)}.`);
  } else {
    const indexSource = fs.readFileSync(indexPath, 'utf8');
    if (version && !indexSource.includes(`${config.currentVersionLabel}: \`${version}\``)) {
      errors.push(`Patch-note index does not list ${config.currentVersionLabel.toLowerCase()} ${version}.`);
    }
    if (!indexSource.includes('<!-- patch-notes:start -->') || !indexSource.includes('<!-- patch-notes:end -->')) {
      errors.push('Patch-note index is missing generated release markers.');
    }
    const expectedLink = `[${version}](${releaseLinkPath(config, currentReleaseFileName)})`;
    if (version && !indexSource.includes(expectedLink)) {
      errors.push(`Patch-note index does not link to ${config.paths.notesDir}/releases/${currentReleaseFileName}.`);
    }
  }
  for (const release of listReleaseSummaries(config)) {
    tryStep(
      errors,
      () => config.versionStrategy.assert(release.version),
      undefined,
      `${config.paths.notesDir}/releases/${release.fileName}: `,
    );
    if (!release.titleVersion) {
      errors.push(`${config.paths.notesDir}/releases/${release.fileName} is missing the standard patch-note title.`);
    }
    if (release.packageVersion && release.packageVersion !== release.version) {
      errors.push(
        `${config.paths.notesDir}/releases/${release.fileName} package version ${release.packageVersion} does not match title version ${release.version}.`,
      );
    }
  }
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

function preflightCut(
  config: ReleaseKitConfig,
  targetVersion: string,
  options: CutReleaseOptions,
): { fragmentCount: number; releasePath: string } {
  config.versionStrategy.assert(targetVersion);
  const rootDir = path.resolve(config.rootDir);
  const { releasesDir } = resolvePaths(config);
  const fragments = collectFragments(config);
  if (fragments.length === 0 && !options.allowEmpty) {
    throw new Error('No unreleased patch-note fragments found. Add fragments or pass --allow-empty.');
  }
  const releasePath = path.join(releasesDir, config.versionStrategy.releaseFileName(targetVersion));
  if (fs.existsSync(releasePath) && !options.force) {
    throw new Error(`${path.relative(rootDir, releasePath)} already exists. Re-run with --force to overwrite it.`);
  }
  return { fragmentCount: fragments.length, releasePath };
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
