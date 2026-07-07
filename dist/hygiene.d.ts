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
}
export declare function collectChangedFiles(rootDir: string, baseRef: string): string[];
export declare function isPatchNoteArtifact(config: ReleaseKitConfig, filePath: string): boolean;
export declare function isReleaseRelevantFile(config: ReleaseKitConfig, filePath: string): boolean;
export declare function classifyReleaseHygiene(config: ReleaseKitConfig, changedFiles: string[]): HygieneResult;
export interface CheckReleaseHygieneOptions {
    baseRef?: string;
}
export declare function checkReleaseHygiene(config: ReleaseKitConfig, options?: CheckReleaseHygieneOptions): HygieneResult;
