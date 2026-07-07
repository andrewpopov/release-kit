/**
 * Version-manifest adapter seam. The host manifest is whatever file(s) a
 * consumer treats as the source of truth for its current version — for
 * rouge that's `package.json` (+ `package-lock.json`).
 */
export interface VersionManifestAdapter {
    readVersion(rootDir: string): string;
    writeVersion(rootDir: string, version: string): void;
    /** Optional extra validation; returns a list of human-readable error strings. */
    validateVersionSync?(rootDir: string, version: string): string[];
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
export declare function npmPackage(options?: NpmPackageOptions): VersionManifestAdapter;
