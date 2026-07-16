/**
 * Version-strategy seam. `VersionStrategy` is the pluggable policy for how a
 * product's version string is shaped, validated, ordered, and mapped to a
 * release-file name. `alphaSemver` reproduces rouge's exact current behavior
 * (`X.Y.Z-alpha.N`, bump only `N`); `stableSemver` provides conventional
 * stable releases (`X.Y.Z`, defaulting to a patch bump).
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
 * `next()` increments the patch component. Callers can still supply an
 * explicit version to the release-kit bump/cut APIs for major or minor cuts.
 */
export declare function stableSemver(options?: StableSemverOptions): VersionStrategy;
