/**
 * Publish/validate flow — ported byte-for-byte from rouge's
 * `scripts/lib/release-notes-core.js`. Happy-path write order (release file
 * -> archive copies -> delete unreleased -> refresh index) matches rouge's
 * original scripts exactly. `cutRelease` (bump -> publish -> validate) is
 * transactional: it snapshots every file a cut can touch before the first
 * write and rolls all of them back — manifest, notes-target output, and
 * archived fragments restored to their original locations — if bump,
 * publish, archive, or the final validation fails (PKG-140 finding 2).
 */
import type { ReleaseKitConfig } from './config';
import type { ReleaseSummary } from './render';
import type { ReleaseNotesTarget } from './notes-target';
export { collectFragments } from './fragments';
export declare function tryStep<T>(errors: string[], fn: () => T, fallback: T, prefix?: string): T;
/** Resolves the config's notes target, defaulting to `patchNotesDirTarget()` (rouge's current behavior). */
export declare function resolveNotesTarget(config: ReleaseKitConfig): ReleaseNotesTarget;
/** Returns `explicitVersion` trimmed, or the manifest's current version. */
export declare function resolveVersion(config: ReleaseKitConfig, explicitVersion?: string): string;
/** Returns `explicitVersion` trimmed, or the strategy's next version after the manifest's current version. */
export declare function nextVersion(config: ReleaseKitConfig, explicitVersion?: string): string;
/** Shells out to `git rev-parse --short HEAD`; returns `""` if unavailable. */
export declare function getGitShortSha(rootDir: string): string;
export interface BumpVersionOptions {
    version?: string;
}
export interface BumpVersionResult {
    previousVersion: string;
    version: string;
}
export declare function bumpVersion(config: ReleaseKitConfig, options?: BumpVersionOptions): BumpVersionResult;
export declare function listReleaseSummaries(config: ReleaseKitConfig): ReleaseSummary[];
export declare function updatePatchNotesIndex(config: ReleaseKitConfig, version: string): void;
export interface PublishReleaseOptions {
    version?: string;
    date?: string;
    commit?: string;
    force?: boolean;
    allowEmpty?: boolean;
}
export interface PublishReleaseResult {
    version: string;
    releasePath: string;
    fragmentCount: number;
    /** This release's rendered notes, as returned by the notes target's `publish` (PKG-140 finding 3). */
    content: string;
    /** This release's date, as returned by the notes target's `publish` — never re-derived by re-parsing `releasePath`. */
    date: string;
}
export interface ReleaseArtifactV1 {
    schemaVersion: 1;
    product: string;
    repository: string;
    version: string;
    commit: string;
    date: string;
    renderedNotes: string;
    notesDigest: string;
    artifactRef: string;
    fragmentCount: number;
}
/**
 * Build a deterministic, transport-neutral descriptor only after validation
 * succeeds. `renderedNotes`/`date` come from `result` — which the notes
 * target itself returned from `publish` — rather than re-reading and
 * re-parsing `result.releasePath`: a target's on-disk file may be a whole
 * cumulative document (e.g. `changelogTarget()`'s `CHANGELOG.md`) that a
 * blind re-parse can't tell apart from the one release just cut (PKG-140
 * finding 3). Likewise `product`/`repository` come from the configured
 * `VersionManifestAdapter` (or generic fallbacks), never from reading
 * `package.json` directly, so a consumer with a non-npm manifest adapter and
 * no `package.json` at the root can still produce a valid artifact (PKG-140
 * finding 4).
 */
export declare function createReleaseArtifactV1(config: ReleaseKitConfig, result: PublishReleaseResult, commit?: string): ReleaseArtifactV1;
export declare function publishRelease(config: ReleaseKitConfig, options?: PublishReleaseOptions): PublishReleaseResult;
export interface ValidateReleaseStateResult {
    ok: boolean;
    errors: string[];
    version: string;
}
export declare function validateReleaseState(config: ReleaseKitConfig, explicitVersion?: string): ValidateReleaseStateResult;
export interface CutReleaseOptions {
    version?: string;
    date?: string;
    commit?: string;
    force?: boolean;
    allowEmpty?: boolean;
}
export interface CutReleaseResult {
    previousVersion: string;
    version: string;
    fragmentCount: number;
    releasePath: string;
    /** This release's rendered notes, as returned by the notes target's `publish` (PKG-140 finding 3). */
    content: string;
    /** This release's date, as returned by the notes target's `publish`. */
    date: string;
}
/**
 * Bumps the manifest to the next (or explicit) version, publishes fragments
 * into a versioned release file, and validates the result — rouge's exact
 * write order (bump -> publish -> validate), matching `cut-release.js`.
 * Fragments are collected once here and threaded through preflight/publish,
 * so the set that chose the version is provably the set that gets published.
 *
 * TRANSACTIONAL (PKG-140 finding 2): `preflightCut` validates everything it
 * can before any write. Everything a cut can still touch after that — the
 * manifest (via `config.manifest.snapshot`), the two directories `archiveDir`/
 * `unreleasedDir` may need creating (PKG-140 finding D), and the notes
 * target's output plus the fragments it archives (via `notesTarget.snapshot`)
 * — is snapshotted BEFORE the bump, so a failure in bump, publish, archive,
 * or the final validation restores every one of those files to its exact
 * pre-cut bytes, including moving archived fragments back to `unreleased/`
 * and removing any directory the cut had to create along the way. Each
 * guard's `commit()` is called right after the write phase it watches
 * finishes successfully, so `restore()` can tell OUR OWN write apart from a
 * legitimate concurrent edit landing afterwards and skip the latter instead
 * of clobbering it (PKG-140 finding B) — see `Guard`'s doc comment in
 * `fs-snapshot.ts`. A rollback failure is appended to (never replaces) the
 * error that triggered it, and any skipped-due-to-conflict path is reported
 * alongside it — see `rollbackOnFailure`.
 */
export declare function cutRelease(config: ReleaseKitConfig, options?: CutReleaseOptions): CutReleaseResult;
