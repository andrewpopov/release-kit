/**
 * Version-manifest adapter seam. The host manifest is whatever file(s) a
 * consumer treats as the source of truth for its current version — for
 * rouge that's `package.json` (+ `package-lock.json`).
 */

import fs from 'node:fs';
import path from 'node:path';

export interface VersionManifestAdapter {
  readVersion(rootDir: string): string;
  writeVersion(rootDir: string, version: string): void;
  /** Optional extra validation; returns a list of human-readable error strings. */
  validateVersionSync?(rootDir: string, version: string): string[];
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
    pkg.version = version;
    writeJsonFile(pkgPath, pkg);

    const lockFilePath = lockPath(rootDir);
    if (!fs.existsSync(lockFilePath)) {
      return;
    }
    const lock = readJsonFile(lockFilePath);
    lock.version = version;
    const packages = lock.packages;
    if (!packages || typeof packages !== 'object' || Array.isArray(packages) || !(packages as JsonRecord)[''])  {
      throw new Error(`${lockFileName} is missing packages[""].version.`);
    }
    ((packages as JsonRecord)[''] as JsonRecord).version = version;
    writeJsonFile(lockFilePath, lock);
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

  return { readVersion, writeVersion, validateVersionSync };
}
