/**
 * Announce-once ledger: tracks which release versions have already been
 * posted to Discord so `announceReleaseToDiscord` can skip a re-announce
 * when a deploy-kit `deliveryEvent` hook fires more than once for the same
 * release (every deploy, not every release).
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ReleaseKitConfig } from './config';

export interface ResolveAnnouncementStatePathOptions {
  /** Explicit override, e.g. from `announceReleaseToDiscord({ stateFile })`. */
  stateFile?: string;
}

export type AnnouncementStatePathSource =
  | 'option'
  | 'env'
  | 'config'
  | 'deploy-kit-shared'
  | 'sibling-shared'
  | 'fallback';

export interface AnnouncementStatePathResolution {
  path: string;
  /**
   * False only for the last-resort `fallback` source: that path lives inside
   * the release directory deploy-kit swaps out wholesale on each deploy, so
   * state written there does not survive across deploys.
   */
  durable: boolean;
  source: AnnouncementStatePathSource;
}

export interface AnnouncedVersionEntry {
  version: string;
  at: string;
  /**
   * Which product recorded this entry. Optional so legacy ledger entries
   * (written before namespacing existed) still match: a missing `product`
   * is treated as matching any product, so production ledgers written
   * pre-namespacing don't cause a spurious re-announce.
   */
  product?: string;
}

export interface AnnouncedVersionsFile {
  announced: AnnouncedVersionEntry[];
}

/**
 * Resolves where the announce-once ledger lives. First hit wins, in order:
 * an explicit `options.stateFile`, `RELEASE_ANNOUNCE_STATE`,
 * `config.paths.announcementStateFile`, deploy-kit's shared dir
 * (`DEPLOY_KIT_SHARED_DIR` + `/release-announcements.json`), a sibling
 * `../shared/release-announcements.json` directory (deploy-kit's releases
 * layout convention, only if that directory actually exists), and finally a
 * fallback file inside `rootDir` itself.
 */
export function resolveAnnouncementStatePath(
  config: ReleaseKitConfig,
  options: ResolveAnnouncementStatePathOptions = {},
): AnnouncementStatePathResolution {
  if (options.stateFile) {
    return { path: options.stateFile, durable: true, source: 'option' };
  }

  const envStateFile = process.env.RELEASE_ANNOUNCE_STATE;
  if (envStateFile) {
    return { path: envStateFile, durable: true, source: 'env' };
  }

  const configuredPath = config.paths.announcementStateFile;
  if (configuredPath) {
    return {
      path: path.join(path.resolve(config.rootDir), configuredPath),
      durable: true,
      source: 'config',
    };
  }

  const sharedDir = process.env.DEPLOY_KIT_SHARED_DIR;
  if (sharedDir) {
    return {
      path: path.join(sharedDir, 'release-announcements.json'),
      durable: true,
      source: 'deploy-kit-shared',
    };
  }

  const rootDir = path.resolve(config.rootDir);
  // Probe one-level-up first (`<rootDir>/../shared`), then two-levels-up
  // (`<rootDir>/../../shared`). deploy-kit's real releases layout is
  // `<app>/releases/<stamp>` with `shared/` a sibling of `releases/`, i.e.
  // two levels up from a release's rootDir — and rootDir is the physical
  // (symlink-resolved) path, so a one-level-up probe alone misses it. Some
  // flatter deploy layouts may still put `shared/` one level up, so that
  // case is checked first and wins if it exists.
  const siblingSharedCandidates = [
    path.join(rootDir, '..', 'shared'),
    path.join(rootDir, '..', '..', 'shared'),
  ];
  for (const siblingSharedDir of siblingSharedCandidates) {
    if (fs.existsSync(siblingSharedDir)) {
      return {
        path: path.join(siblingSharedDir, 'release-announcements.json'),
        durable: true,
        source: 'sibling-shared',
      };
    }
  }

  return {
    path: path.join(rootDir, '.release-announcements.json'),
    durable: false,
    source: 'fallback',
  };
}

function isAnnouncedVersionEntry(value: unknown): value is AnnouncedVersionEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { version?: unknown }).version === 'string'
  );
}

/**
 * Reads the announce-once ledger. Never throws: a missing file, an empty
 * file, unparseable JSON, or JSON with junk in place of `announced` all
 * degrade to `{ announced: [] }`.
 */
export function readAnnouncedVersions(statePath: string): AnnouncedVersionsFile {
  let raw: string;
  try {
    raw = fs.readFileSync(statePath, 'utf8');
  } catch {
    return { announced: [] };
  }
  if (!raw.trim()) {
    return { announced: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { announced: [] };
  }

  const announcedRaw =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as { announced?: unknown }).announced
      : undefined;
  if (!Array.isArray(announcedRaw)) {
    return { announced: [] };
  }

  return { announced: announcedRaw.filter(isAnnouncedVersionEntry) };
}

/**
 * Whether `entry` matches a query for `version`/`product`: the version must
 * match exactly, and either the products match or the entry predates
 * namespacing (no `product` field), which is treated as matching any
 * product so legacy ledger entries keep suppressing re-announces.
 */
function matchesVersion(entry: AnnouncedVersionEntry, version: string, product?: string): boolean {
  if (entry.version !== version) {
    return false;
  }
  return entry.product === undefined || entry.product === product;
}

/**
 * Whether `version` is already recorded in the ledger at `statePath` for
 * `product`. A ledger entry with no `product` (written before namespacing
 * existed) matches any product.
 */
export function hasAnnouncedVersion(statePath: string, version: string, product?: string): boolean {
  return readAnnouncedVersions(statePath).announced.some((entry) =>
    matchesVersion(entry, version, product),
  );
}

/**
 * Records `version` (namespaced by `product`, when given) as announced,
 * replacing any existing matching entry so the ledger doesn't grow
 * duplicates on a forced re-announce. Best-effort bookkeeping: creates
 * parent directories as needed, writes atomically (temp file + rename) so a
 * concurrent reader never sees a partially-written file, and never
 * throws — a write failure is logged via `console.warn` and swallowed
 * rather than failing the caller.
 */
export function recordAnnouncedVersion(statePath: string, version: string, product?: string): void {
  try {
    const existing = readAnnouncedVersions(statePath);
    const remaining = existing.announced.filter((entry) => !matchesVersion(entry, version, product));
    const entry: AnnouncedVersionEntry = { version, at: new Date().toISOString() };
    if (product !== undefined) {
      entry.product = product;
    }
    const next: AnnouncedVersionsFile = { announced: [...remaining, entry] };
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    const tmpPath = path.join(
      path.dirname(statePath),
      `.${path.basename(statePath)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    fs.writeFileSync(tmpPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    fs.renameSync(tmpPath, statePath);
  } catch (error) {
    console.warn(
      `release-kit: failed to record announced version ${version} at ${statePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
