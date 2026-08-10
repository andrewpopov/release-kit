/**
 * Fragment parsing/collection/creation — ported byte-for-byte from rouge's
 * `scripts/lib/release-notes-core.js`. Kind validation and ordering come
 * from `config.kinds` instead of a hardcoded list.
 */
import type { ReleaseKitConfig } from './config';
export interface Fragment {
    filePath: string;
    fileName: string;
    kind: string;
    summary: string;
    body: string;
}
export interface ParsedFrontMatter {
    meta: Record<string, string>;
    body: string;
}
export declare function parseFrontMatter(source: string, filePath?: string): ParsedFrontMatter;
export declare function slugify(value: string | undefined | null): string;
/** ISO date (`YYYY-MM-DD`) for `now` (defaults to the current time). */
export declare function todayIso(now?: Date): string;
export declare function isFragmentFile(fileName: string): boolean;
/**
 * Whether `body` is still the generated scaffold placeholder (`note` writes
 * this exact text — see `writeNewFragment` below). Single definition shared
 * by `parseFragment` (used by `check`/`publish`) and `hygiene`'s ratchet
 * check, so the two can never disagree about what counts as unwritten.
 */
export declare function isPlaceholderBody(config: ReleaseKitConfig, body: string | undefined | null): boolean;
/**
 * Extracts a fragment's summary from parsed front matter (`summary`, falling
 * back to `title`). One definition shared by `parseFragment` and `hygiene`'s
 * changed-fragment validation so the two can never derive a different
 * summary for the same file.
 */
export declare function extractSummary(meta: Record<string, string>): string;
export interface FragmentContentIssue {
    code: 'placeholder-body' | 'trailing-period-summary';
    /** Message text WITHOUT the file-path prefix — callers prepend their own. */
    message: string;
}
/**
 * Content-quality checks that apply once a fragment has a non-empty summary
 * and body (presence is checked separately by `parseFragment`, since a
 * missing summary/body is a different failure mode with its own message).
 * Single definition shared by `parseFragment` (used by `check`/`publish`) and
 * `hygiene`'s ratchet check, so the two paths cannot drift apart on what
 * counts as an unwritten placeholder or an unrenderable summary — the exact
 * gap PTRY-509 closed for the placeholder rule and PTRY-526 closes for the
 * summary rule.
 */
export declare function validateFragmentContent(config: ReleaseKitConfig, content: {
    summary: string;
    body: string;
}): FragmentContentIssue[];
export declare function parseFragment(filePath: string, rootDir: string, config: ReleaseKitConfig): Fragment;
export declare function collectFragments(config: ReleaseKitConfig): Fragment[];
export declare function normalizeFragmentBody(body: string | undefined | null): string;
export interface WriteNewFragmentOptions {
    kind?: string;
    slug?: string;
    summary?: string;
}
export declare function writeNewFragment(config: ReleaseKitConfig, options: WriteNewFragmentOptions): string;
