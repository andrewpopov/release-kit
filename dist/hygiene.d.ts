/**
 * Release-hygiene classification — ported byte-for-byte from rouge's
 * `scripts/check-release-hygiene.js`. The classification LISTS come from
 * `config.hygiene`; the algorithm (git diff collection, path matching) is
 * generic.
 */
import type { ReleaseKitConfig } from './config';
export interface HygieneResult {
    ok: boolean;
    changedFiles: string[];
    hasPatchNoteUpdate: boolean;
    patchNoteFiles: string[];
    relevantFiles: string[];
    requiresPatchNote: boolean;
    /**
     * Patch-note files that are part of THIS change (i.e. present in
     * `patchNoteFiles`) and whose body is still the generated scaffold
     * placeholder. Scoped to changed fragments only — a ratchet, not a
     * retroactive check: a pre-existing placeholder fragment nobody touched
     * this change is never read, so it can't fail a push that didn't add it.
     * A fragment removed by this change (no longer on disk) is skipped too,
     * since there is no body left to check.
     */
    placeholderPatchNoteFiles: string[];
}
export declare function collectChangedFiles(rootDir: string, baseRef: string): string[];
export declare function isPatchNoteArtifact(config: ReleaseKitConfig, filePath: string): boolean;
export declare function isReleaseRelevantFile(config: ReleaseKitConfig, filePath: string): boolean;
export declare function classifyReleaseHygiene(config: ReleaseKitConfig, changedFiles: string[]): HygieneResult;
export interface CheckReleaseHygieneOptions {
    baseRef?: string;
}
export declare function checkReleaseHygiene(config: ReleaseKitConfig, options?: CheckReleaseHygieneOptions): HygieneResult;
