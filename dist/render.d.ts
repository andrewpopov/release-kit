/**
 * Release-note and patch-notes-index rendering — ported byte-for-byte from
 * rouge's `scripts/lib/release-notes-core.js`. `renderReleaseNote` is pure
 * given fragments + an injected date/commit. The title line (and its
 * parser) are driven by `config.titleTemplate` so they can never drift.
 */
import type { ReleaseKitConfig } from './config';
import type { Fragment } from './fragments';
export interface ReleaseSummary {
    titleVersion: string;
    version: string;
    date: string;
    stage: string;
    packageVersion: string;
    fileName: string;
}
export interface RenderReleaseNoteOptions {
    version: string;
    date: string;
    fragments: Fragment[];
    commit?: string;
}
export declare function renderReleaseNote(config: ReleaseKitConfig, options: RenderReleaseNoteOptions): string;
export declare function parseReleaseSummary(config: ReleaseKitConfig, filePath: string): ReleaseSummary;
export declare function renderPatchNotesIndex(config: ReleaseKitConfig, releases: ReleaseSummary[], version: string): string;
