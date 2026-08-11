/**
 * Version-manifest adapter seam. The host manifest is whatever file(s) a
 * consumer treats as the source of truth for its current version — for
 * rouge that's `package.json` (+ `package-lock.json`).
 */
import type { Guard } from './fs-snapshot';
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
