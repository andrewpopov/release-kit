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
    /**
     * Loud, non-fatal warnings about reduced coverage. Populated only when
     * `allowMissingHistory` downgraded an otherwise-fatal base-ref failure to
     * a working-tree-only check (see `checkReleaseHygiene`). Empty in the
     * normal case — `classifyReleaseHygiene` (which has no git access) always
     * returns `[]` here; `checkReleaseHygiene` fills it in.
     */
    warnings: string[];
}
/**
 * Why a git failure DURING hygiene must never be silently treated as "no
 * changes": the classification below (`ok`) is a straightforward function of
 * the changed-file set, so an empty set is indistinguishable from "nothing
 * changed" — a gate that can't tell "clean" apart from "broken" will report
 * clean. `kind` lets a caller (the CLI, or a programmatic consumer) give
 * targeted advice instead of a raw git stderr dump; `message` is already a
 * complete, actionable sentence on its own.
 */
export type HygieneGitFailureKind = 'git-unavailable' | 'not-a-git-repo' | 'base-ref-not-found' | 'insufficient-history' | 'git-command-failed';
export declare class HygieneGitError extends Error {
    readonly kind: HygieneGitFailureKind;
    constructor(kind: HygieneGitFailureKind, message: string);
}
/**
 * Collects the changed-file set hygiene classifies against. FAILS CLOSED:
 * any git failure (missing binary, not a repo, an unresolvable base ref,
 * insufficient history) throws a `HygieneGitError` instead of degrading to
 * an empty (falsely-passing) result — see `checkReleaseHygiene` for the one
 * explicit, opt-in way to downgrade a base-ref failure instead of failing.
 */
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
    /**
     * Explicit, opt-in escape hatch for a consumer that genuinely cannot
     * supply enough git history to compute a base-ref diff (see
     * `HygieneConfig.allowMissingHistory`'s doc comment for when that's a
     * legitimate situation vs. a checkout that should just fetch more history).
     * Never defaults to `true`. When `true` AND the failure is specifically
     * `base-ref-not-found` or `insufficient-history` (a history problem, not
     * "git doesn't work at all"), hygiene falls back to a working-tree-only
     * check and appends a warning to `HygieneResult.warnings` — it does NOT
     * silently pass; the reduced coverage is reported loudly. `git-unavailable`
     * and `not-a-git-repo` are never downgraded: those checkouts can't compute
     * ANY diff, base-ref or otherwise, so there is nothing to fall back to.
     */
    allowMissingHistory?: boolean;
}
export declare function checkReleaseHygiene(config: ReleaseKitConfig, options?: CheckReleaseHygieneOptions): HygieneResult;
