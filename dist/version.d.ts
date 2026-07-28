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
export declare const DEFAULT_KIND_BUMP: Readonly<Record<string, BumpLevel>>;
export interface VersionBumpContext {
    /** Highest semantic weight across the fragments being released. */
    bump?: BumpLevel;
}
/** Highest bump level across `kinds` for the given fragment kind ids. Empty → 'patch'. */
export declare function resolveBumpLevel(fragmentKindIds: string[], kinds: ReleaseKindDef[]): BumpLevel;
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
export declare const ALPHA_VERSION_RE: RegExp;
/** `X.Y.Z` with numeric major, minor, and patch components. */
export declare const STABLE_VERSION_RE: RegExp;
/**
 * Alpha-semver version strategy: `0.1.0-alpha.0`, `0.1.0-alpha.1`, ...
 * `next()` only ever bumps the trailing alpha counter.
 */
export declare function alphaSemver(options?: AlphaSemverOptions): VersionStrategy;
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
export declare function stableSemver(options?: StableSemverOptions): VersionStrategy;
