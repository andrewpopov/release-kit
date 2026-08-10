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
    /**
     * Patch-note files that are part of THIS change and whose summary ends in
     * `.` — the renderer emits `**{summary}:**`, so a trailing period renders
     * `**Summary.:**`. Same ratchet scoping as `placeholderPatchNoteFiles`: a
     * pre-existing trailing-period fragment nobody touched this change is
     * never read, and a fragment removed by this change is skipped.
     */
    trailingPeriodSummaryPatchNoteFiles: string[];
}
export declare function collectChangedFiles(rootDir: string, baseRef: string): string[];
export declare function isPatchNoteArtifact(config: ReleaseKitConfig, filePath: string): boolean;
/**
 * Default `hygiene.excludePatterns` — test files. Every consuming repo's
 * `relevantPrefixes` (e.g. `packages/web-app/src/`) sweeps in test files
 * living under the same tree (`src/**\/__tests__/**`, `*.test.ts`,
 * `*.spec.tsx`), so a change that adds ONLY tests was classified
 * release-relevant and blocked at push time for a change no user can
 * observe (PTRY-524).
 */
export declare const DEFAULT_HYGIENE_EXCLUDE_PATTERNS: string[];
/**
 * Whether `normalizedPath` matches a single `excludePatterns` glob. A
 * pattern containing `/` is matched against the full normalized path (it
 * names a directory shape, e.g. `**\/__tests__/**`); a pattern with no `/` is
 * matched against the basename only (it names a filename shape, e.g.
 * `*.test.*`), the same convention `.gitignore` uses — otherwise a bare
 * `*.test.*` could only ever match a file living at the repo root.
 */
export declare function matchesHygieneExcludePattern(pattern: string, normalizedPath: string): boolean;
export declare function isReleaseRelevantFile(config: ReleaseKitConfig, filePath: string): boolean;
export declare function classifyReleaseHygiene(config: ReleaseKitConfig, changedFiles: string[]): HygieneResult;
export interface CheckReleaseHygieneOptions {
    baseRef?: string;
}
export declare function checkReleaseHygiene(config: ReleaseKitConfig, options?: CheckReleaseHygieneOptions): HygieneResult;
