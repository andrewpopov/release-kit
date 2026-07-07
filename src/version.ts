/**
 * Version-strategy seam. `VersionStrategy` is the pluggable policy for how a
 * product's version string is shaped, validated, ordered, and mapped to a
 * release-file name. `alphaSemver` reproduces rouge's exact current behavior
 * (`X.Y.Z-alpha.N`, bump only `N`).
 */

import type { ReleaseSummary } from './render';

export interface VersionStrategy {
  /** Throws if `version` does not satisfy this strategy's shape. */
  assert(version: string): void;
  /** Computes the next version after `version`. */
  next(version: string): string;
  /**
   * Comparator for sorting release summaries newest-first (descending).
   * Mirrors `Array.prototype.sort`'s comparator contract.
   */
  compareDesc(a: ReleaseSummary, b: ReleaseSummary): number;
  /** Maps a version string to its release-file name (e.g. `${version}.md`). */
  releaseFileName(version: string): string;
}

export interface AlphaSemverOptions {
  /**
   * Human-readable label used in error messages, e.g. `Game version "0.1.0"
   * must use alpha semver...`. Defaults to `"Version"`.
   */
  versionLabel?: string;
}

/** `X.Y.Z-alpha.N` — matches rouge's `ALPHA_VERSION_RE` exactly. */
export const ALPHA_VERSION_RE = /^(\d+)\.(\d+)\.(\d+)-alpha\.(\d+)$/;

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

  function next(version: string): string {
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

  return { assert, next, compareDesc, releaseFileName };
}
