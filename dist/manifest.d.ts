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
