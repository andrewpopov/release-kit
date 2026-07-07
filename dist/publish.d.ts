/**
 * Publish/validate flow — ported byte-for-byte from rouge's
 * `scripts/lib/release-notes-core.js`. STRICT PARITY for v0.1.0: this
 * replicates rouge's exact current write order (release file -> archive
 * copies -> delete unreleased -> refresh index) with NO transactional
 * rollback. That hardening is deferred to v0.1.1 (see the extraction plan).
 */
import type { ReleaseKitConfig } from './config';
import type { ReleaseSummary } from './render';
export { collectFragments } from './fragments';
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
}
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
}
/**
 * Bumps the manifest to the next (or explicit) version, publishes fragments
 * into a versioned release file, and validates the result — rouge's exact
 * current order (bump -> publish -> validate), matching `cut-release.js`.
 */
export declare function cutRelease(config: ReleaseKitConfig, options?: CutReleaseOptions): CutReleaseResult;
