/**
 * Version-manifest adapter seam. The host manifest is whatever file(s) a
 * consumer treats as the source of truth for its current version — for
 * rouge that's `package.json` (+ `package-lock.json`).
 */

import fs from 'node:fs';
import path from 'node:path';
import { combineRestores, snapshotFile } from './fs-snapshot';

export interface VersionManifestAdapter {
  readVersion(rootDir: string): string;
  writeVersion(rootDir: string, version: string): void;
  /** Optional extra validation; returns a list of human-readable error strings. */
  validateVersionSync?(rootDir: string, version: string): string[];
  /**
   * Optional rollback support. Snapshots whatever `writeVersion` is about to
   * touch and returns a function that restores it byte-for-byte. `cutRelease`
   * calls this BEFORE `writeVersion` and invokes the returned function if a
   * later step (publish, archive, validation) fails, so that failure doesn't
   * leave the manifest bumped. Adapters that don't implement this are simply
   * skipped by `cutRelease` — best effort, not required — so a custom
   * third-party adapter without `snapshot` degrades gracefully: the rest of
   * the cut still rolls back, just not the manifest.
   */
  snapshot?(rootDir: string): () => void;
}

interface JsonRecord {
  [key: string]: unknown;
}

function readJsonFile(filePath: string): JsonRecord {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as JsonRecord;
}

function writeJsonFile(filePath: string, value: JsonRecord): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export interface NpmPackageOptions {
  /**
   * When `true` (default), a present `package-lock.json` is required to
   * declare `packages[""].version` and kept in sync. When `false`/absent
   * lockfile, writes/validation of the lockfile are skipped (no-throw).
   */
  packageFileName?: string;
  lockFileName?: string;
}

/**
 * `npmPackage` adapter — reads/writes `package.json` (+ `package-lock.json`
 * when present) exactly as rouge's current tooling does, but in
 * OPTIONAL-lockfile mode: a missing lockfile is not an error.
 */
export function npmPackage(options: NpmPackageOptions = {}): VersionManifestAdapter {
  const packageFileName = options.packageFileName ?? 'package.json';
  const lockFileName = options.lockFileName ?? 'package-lock.json';

  function packagePath(rootDir: string): string {
    return path.join(rootDir, packageFileName);
  }

  function lockPath(rootDir: string): string {
    return path.join(rootDir, lockFileName);
  }

  function readVersion(rootDir: string): string {
    const pkg = readJsonFile(packagePath(rootDir));
    return String(pkg.version || '').trim();
  }

  function writeVersion(rootDir: string, version: string): void {
    const pkgPath = packagePath(rootDir);
    const pkg = readJsonFile(pkgPath);

    // Read AND shape-validate the lockfile BEFORE writing anything: a
    // malformed lockfile must fail before package.json is touched, not
    // after (PKG-140 finding 2) — otherwise a half-bumped manifest is left
    // behind for every consumer whose lockfile happens to be malformed.
    const lockFilePath = lockPath(rootDir);
    const lockFileExists = fs.existsSync(lockFilePath);
    let lock: JsonRecord | undefined;
    if (lockFileExists) {
      lock = readJsonFile(lockFilePath);
      const packages = lock.packages;
      if (!packages || typeof packages !== 'object' || Array.isArray(packages) || !(packages as JsonRecord)[''])  {
        throw new Error(`${lockFileName} is missing packages[""].version.`);
      }
    }

    pkg.version = version;
    writeJsonFile(pkgPath, pkg);

    if (lockFileExists && lock) {
      lock.version = version;
      ((lock.packages as JsonRecord)[''] as JsonRecord).version = version;
      writeJsonFile(lockFilePath, lock);
    }
  }

  /** See `VersionManifestAdapter.snapshot`'s doc comment. */
  function snapshot(rootDir: string): () => void {
    return combineRestores([snapshotFile(packagePath(rootDir)), snapshotFile(lockPath(rootDir))]);
  }

  function validateVersionSync(rootDir: string, version: string): string[] {
    const errors: string[] = [];
    const lockFilePath = lockPath(rootDir);
    if (!fs.existsSync(lockFilePath)) {
      return errors;
    }
    let lock: JsonRecord;
    try {
      lock = readJsonFile(lockFilePath);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      return errors;
    }
    const lockVersion = String(lock.version || '').trim();
    const packages = lock.packages as JsonRecord | undefined;
    const rootPackageVersion = String((packages?.[''] as JsonRecord | undefined)?.version || '').trim();
    if (lockVersion !== version) {
      errors.push(`${lockFileName} version ${lockVersion || '(missing)'} does not match ${packageFileName} version ${version}.`);
    }
    if (rootPackageVersion !== version) {
      errors.push(`${lockFileName} packages[""].version ${rootPackageVersion || '(missing)'} does not match ${packageFileName} version ${version}.`);
    }
    return errors;
  }

  return { readVersion, writeVersion, validateVersionSync, snapshot };
}
