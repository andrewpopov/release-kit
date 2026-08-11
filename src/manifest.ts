/**
 * Version-manifest adapter seam. The host manifest is whatever file(s) a
 * consumer treats as the source of truth for its current version — for
 * rouge that's `package.json` (+ `package-lock.json`).
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Guard } from './fs-snapshot';
import { combineRestores, snapshotFile } from './fs-snapshot';

export interface VersionManifestAdapter {
  readVersion(rootDir: string): string;
  writeVersion(rootDir: string, version: string): void;
  /** Optional extra validation; returns a list of human-readable error strings. */
  validateVersionSync?(rootDir: string, version: string): string[];
  /**
   * Optional rollback support. Snapshots whatever `writeVersion` is about to
   * touch and returns a `Guard`: `cutRelease` calls this BEFORE
   * `writeVersion`, calls the guard's `commit()` right after `writeVersion`
   * returns successfully, and invokes `restore()` if a LATER step (publish,
   * archive, validation) fails, so that failure doesn't leave the manifest
   * bumped. `restore()` only overwrites a file whose current bytes still
   * match what `commit()` observed — a legitimate concurrent edit made
   * after `writeVersion` ran is left alone and reported, never clobbered
   * (PKG-140 finding B). Adapters that don't implement this are simply
   * skipped by `cutRelease` — best effort, not required — so a custom
   * third-party adapter without `snapshot` degrades gracefully: the rest of
   * the cut still rolls back, just not the manifest.
   */
  snapshot?(rootDir: string): Guard;
  /**
   * Optional: product name + repository URL for `ReleaseArtifactV1`
   * (PKG-140 finding 4). When omitted, `createReleaseArtifactV1` falls back
   * to `config.productName` for `product` and `rootDir` for `repository` —
   * it never reads a manifest file directly, so a custom adapter with no
   * `package.json` at the root can still produce a valid artifact. Either
   * returned field may itself be omitted; each falls back independently.
   */
  readArtifactMetadata?(rootDir: string): ArtifactMetadata;
}

export interface ArtifactMetadata {
  product?: string;
  repository?: string;
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

  // Set by `snapshot()` (called BEFORE `writeVersion` by `cutRelease`) and
  // read by `writeVersion` so each write can commit its OWN guard the
  // instant it lands — see the comments inline below for why that matters.
  let activeGuards: { pkg: Guard; lock: Guard } | undefined;

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
    // Commit the moment this write lands, not after the whole function
    // returns: if the lock-file write below then throws, package.json's
    // guard must already know these are OUR bytes, so a later rollback
    // still restores it unconditionally (nothing has raced us for it yet)
    // instead of mistaking its own bumped content for a stranger's edit.
    activeGuards?.pkg.commit();

    if (lockFileExists && lock) {
      lock.version = version;
      ((lock.packages as JsonRecord)[''] as JsonRecord).version = version;
      writeJsonFile(lockFilePath, lock);
      activeGuards?.lock.commit();
    }
  }

  /**
   * See `VersionManifestAdapter.snapshot`'s doc comment. Stashes the two
   * per-file guards in `activeGuards` so `writeVersion` (called later, by
   * `cutRelease`, using this SAME adapter instance) can commit each one the
   * instant its own write lands — see the comments inside `writeVersion`.
   */
  function snapshot(rootDir: string): Guard {
    const pkg = snapshotFile(packagePath(rootDir));
    const lock = snapshotFile(lockPath(rootDir));
    activeGuards = { pkg, lock };
    return {
      commit() {
        pkg.commit();
        lock.commit();
      },
      restore: combineRestores([pkg.restore, lock.restore]),
    };
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

  /**
   * Preserves, byte-for-byte, the product/repository derivation
   * `createReleaseArtifactV1` used to inline before PKG-140 finding 4: the
   * package's `name` (falling back to the root directory's basename) and its
   * `repository` field (a bare string, or `{ url }`, falling back to
   * `rootDir`). Moving it here — rather than changing what it returns — is
   * what keeps `npmPackage()` behaving exactly as it did for existing
   * consumers.
   */
  function readArtifactMetadata(rootDir: string): ArtifactMetadata {
    const pkg = readJsonFile(packagePath(rootDir)) as { name?: string; repository?: string | { url?: string } };
    const repository = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url ?? rootDir;
    return { product: pkg.name ?? path.basename(rootDir), repository };
  }

  return { readVersion, writeVersion, validateVersionSync, snapshot, readArtifactMetadata };
}
