/**
 * Fragment parsing/collection/creation — ported byte-for-byte from rouge's
 * `scripts/lib/release-notes-core.js`. Kind validation and ordering come
 * from `config.kinds` instead of a hardcoded list.
 */
import type { ReleaseKindDef, ReleaseKitConfig } from './config';
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
export declare function parseFragment(filePath: string, rootDir: string, kinds: ReleaseKindDef[]): Fragment;
export declare function collectFragments(config: ReleaseKitConfig): Fragment[];
export declare function normalizeFragmentBody(body: string | undefined | null): string;
export interface WriteNewFragmentOptions {
    kind?: string;
    slug?: string;
    summary?: string;
}
export declare function writeNewFragment(config: ReleaseKitConfig, options: WriteNewFragmentOptions): string;
