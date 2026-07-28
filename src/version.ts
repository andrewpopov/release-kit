/**
 * Version-strategy seam. `VersionStrategy` is the pluggable policy for how a
 * product's version string is shaped, validated, ordered, and mapped to a
 * release-file name. `alphaSemver` reproduces rouge's exact current behavior
 * (`X.Y.Z-alpha.N`, bump only `N`); `stableSemver` provides conventional
 * stable releases (`X.Y.Z`, defaulting to a patch bump).
 */

import type { ReleaseSummary } from './render';
import type { ReleaseKindDef } from './config';

export type BumpLevel = 'major' | 'minor' | 'patch';

/** Conventional weight for the well-known kind ids. Any other id defaults to 'patch'
 *  and must declare `bump` on its ReleaseKindDef to weigh more. */
export const DEFAULT_KIND_BUMP: Readonly<Record<string, BumpLevel>> = Object.freeze({
  breaking: 'major',
  added: 'minor',
});

export interface VersionBumpContext {
  /** Highest semantic weight across the fragments being released. */
  bump?: BumpLevel;
}

const BUMP_RANK: Readonly<Record<BumpLevel, number>> = Object.freeze({ major: 2, minor: 1, patch: 0 });

/**
 * Own-property lookup, NOT `bump in BUMP_RANK` — a runtime-loaded CJS config
 * is not type-checked, and `in` would accept inherited `Object.prototype` keys
 * (`"toString"`, `"constructor"`, ...), which then rank as `undefined` and
 * silently degrade to a patch bump. That is the exact class of silent
 * mislabeling this whole change exists to remove.
 */
function isBumpLevel(value: unknown): value is BumpLevel {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(BUMP_RANK, value);
}

/** Highest bump level across `kinds` for the given fragment kind ids. Empty → 'patch'. */
export function resolveBumpLevel(fragmentKindIds: string[], kinds: ReleaseKindDef[]): BumpLevel {
  let highest: BumpLevel = 'patch';
  for (const kindId of fragmentKindIds) {
    const def = kinds.find((kind) => kind.id === kindId);
    const bump = def?.bump ?? DEFAULT_KIND_BUMP[kindId] ?? 'patch';
    if (!isBumpLevel(bump)) {
      throw new Error(`Kind "${kindId}" declares an unknown bump level "${String(bump)}". Expected one of: major, minor, patch.`);
    }
    if (BUMP_RANK[bump] > BUMP_RANK[highest]) {
      highest = bump;
    }
  }
  return highest;
}

export interface VersionStrategy {
  /** Throws if `version` does not satisfy this strategy's shape. */
  assert(version: string): void;
  /** Computes the next version after `version`, optionally weighted by `context.bump`. */
  next(version: string, context?: VersionBumpContext): string;
  /**
   * Comparator for sorting release summaries newest-first (descending).
   * Mirrors `Array.prototype.sort`'s comparator contract.
   */
  compareDesc(a: ReleaseSummary, b: ReleaseSummary): number;
  /** Maps a version string to its release-file name (e.g. `${version}.md`). */
  releaseFileName(version: string): string;
  /**
   * Whether this strategy honours `VersionBumpContext.bump`.
   *  - 'supported' — next() derives the bump from the context.
   *  - 'ignored'   — deliberately version-scheme-independent (e.g. alpha counters).
   *  - absent      — legacy/unknown; release-kit REFUSES an implicit non-patch cut.
   * Declared, never inferred: probing a strategy by calling it twice is unsound.
   */
  bumpLevelSupport?: 'supported' | 'ignored';
}

export interface AlphaSemverOptions {
  /**
   * Human-readable label used in error messages, e.g. `Game version "0.1.0"
   * must use alpha semver...`. Defaults to `"Version"`.
   */
  versionLabel?: string;
}

export interface StableSemverOptions {
  /**
   * Human-readable label used in error messages, e.g. `Service version
   * "1.0" must use stable semver...`. Defaults to `"Version"`.
   */
  versionLabel?: string;
}

/** `X.Y.Z-alpha.N` — matches rouge's `ALPHA_VERSION_RE` exactly. */
export const ALPHA_VERSION_RE = /^(\d+)\.(\d+)\.(\d+)-alpha\.(\d+)$/;

/** `X.Y.Z` with numeric major, minor, and patch components. */
export const STABLE_VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * Alpha-semver version strategy: `0.1.0-alpha.0`, `0.1.0-alpha.1`, ...
 * `next()` only ever bumps the trailing alpha counter.
 */
export function alphaSemver(options: AlphaSemverOptions = {}): VersionStrategy {
  const versionLabel = options.versionLabel ?? 'Version';

  function assert(version: string): void {
    if (!ALPHA_VERSION_RE.test(String(version || ''))) {
      throw new Error(`${versionLabel} "${version}" must use alpha semver, for example 0.1.0-alpha.0.`);
    }
  }

  // Deliberate product policy: an alpha line bumps only its trailing counter,
  // so a `breaking` fragment does not move the core version. Hence
  // `bumpLevelSupport: 'ignored'` below — the context is accepted, not read.
  function next(version: string, _context?: VersionBumpContext): string {
    const match = String(version || '').match(ALPHA_VERSION_RE);
    if (!match) {
      assert(version);
    }
    const parts = match as RegExpMatchArray;
    return `${parts[1]}.${parts[2]}.${parts[3]}-alpha.${Number(parts[4]) + 1}`;
  }

  function releaseFileName(version: string): string {
    assert(version);
    return `${version}.md`;
  }

  function compareDesc(a: ReleaseSummary, b: ReleaseSummary): number {
    const leftMatch = String(a.version || '').match(ALPHA_VERSION_RE);
    const rightMatch = String(b.version || '').match(ALPHA_VERSION_RE);
    if (leftMatch && rightMatch) {
      for (let index = 1; index <= 4; index += 1) {
        const delta = Number(rightMatch[index]) - Number(leftMatch[index]);
        if (delta !== 0) {
          return delta;
        }
      }
    }
    return a.date !== b.date
      ? String(b.date || '').localeCompare(String(a.date || ''))
      : String(b.version || '').localeCompare(String(a.version || ''));
  }

  return { assert, next, compareDesc, releaseFileName, bumpLevelSupport: 'ignored' };
}

/**
 * Stable-semver version strategy: `1.0.0`, `1.0.1`, ...
 * `next()` derives the bump from `context.bump` (default `'patch'`):
 *  - `major` bumps the major component, EXCEPT pre-1.0 (`0.x.y`), where a
 *    breaking change bumps minor instead — 0.x already declares an unstable
 *    API, so there is no major to bump into.
 *  - `minor` bumps the minor component and resets patch.
 *  - `patch` (or an absent context) increments the patch component, matching
 *    the previous unconditional behavior.
 * Callers can still supply an explicit version to the release-kit bump/cut
 * APIs to bypass this derivation entirely.
 */
export function stableSemver(options: StableSemverOptions = {}): VersionStrategy {
  const versionLabel = options.versionLabel ?? 'Version';

  function parse(version: string): RegExpMatchArray {
    const match = String(version || '').match(STABLE_VERSION_RE);
    if (!match) {
      throw new Error(`${versionLabel} "${version}" must use stable semver, for example 1.0.0.`);
    }
    return match;
  }

  function assert(version: string): void {
    parse(version);
  }

  function next(version: string, context?: VersionBumpContext): string {
    const match = parse(version);
    const major = Number(match[1]);
    const minor = Number(match[2]);
    const patch = Number(match[3]);
    const bump = context?.bump ?? 'patch';
    if (bump === 'major') {
      return major === 0 ? `0.${minor + 1}.0` : `${major + 1}.0.0`;
    }
    if (bump === 'minor') {
      return `${major}.${minor + 1}.0`;
    }
    return `${major}.${minor}.${patch + 1}`;
  }

  function releaseFileName(version: string): string {
    assert(version);
    return `${version}.md`;
  }

  function compareDesc(a: ReleaseSummary, b: ReleaseSummary): number {
    const leftMatch = String(a.version || '').match(STABLE_VERSION_RE);
    const rightMatch = String(b.version || '').match(STABLE_VERSION_RE);
    if (leftMatch && rightMatch) {
      for (let index = 1; index <= 3; index += 1) {
        const delta = Number(rightMatch[index]) - Number(leftMatch[index]);
        if (delta !== 0) {
          return delta;
        }
      }
    }
    return a.date !== b.date
      ? String(b.date || '').localeCompare(String(a.date || ''))
      : String(b.version || '').localeCompare(String(a.version || ''));
  }

  return { assert, next, compareDesc, releaseFileName, bumpLevelSupport: 'supported' };
}
