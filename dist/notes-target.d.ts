/**
 * Notes-target seam: pluggable policy for WHERE a version's release notes
 * get written and HOW their published state is validated. `patchNotesDirTarget`
 * is the DEFAULT and reproduces rouge's current per-version-file + index
 * behavior byte-for-byte (extracted, not rewritten, from `publish.ts`).
 * `changelogTarget` is the new flat-`CHANGELOG.md` target for consumers whose
 * CI greps `^## <version>`.
 */
import type { ReleaseKitConfig } from './config';
import type { Fragment } from './fragments';
export interface ReleaseNotesPublishContext {
    version: string;
    date: string;
    commit: string;
    fragments: Fragment[];
}
export interface ReleaseNotesTarget {
    /** Write the version's notes into the target and consume its fragments. Returns the written file path. */
    publish(config: ReleaseKitConfig, ctx: ReleaseNotesPublishContext, options: {
        force?: boolean;
    }): {
        releasePath: string;
    };
    /** Return validation error strings for the target's state at `version` (empty array = ok). */
    validate(config: ReleaseKitConfig, version: string): string[];
    /** Returns whether `version`'s notes already exist in the target (checked pre-mutation by `preflightCut`). */
    hasVersion(config: ReleaseKitConfig, version: string): boolean;
}
/**
 * DEFAULT target: rouge's current behavior — a `releases/<version>.md` file
 * per version plus a generated `PATCH_NOTES.md` index. Byte-identical to the
 * pre-seam `publishRelease`/`validateReleaseState` bodies; see
 * `golden.test.ts` / `rouge-real-files.test.ts`.
 */
export declare function patchNotesDirTarget(): ReleaseNotesTarget;
export interface ChangelogTargetOptions {
    /** Relative (POSIX-style) path to the changelog file, resolved against `config.rootDir`. Default: `"CHANGELOG.md"`. */
    changelogPath?: string;
    /** Title written as `# <title>` when the file doesn't exist yet. Default: `"Changelog"`. */
    title?: string;
    /** When `true`, emit `### <kind heading>` subsections under each version. Default: `false` (flat bullet list). */
    groupByKind?: boolean;
}
/**
 * NEW target: a single flat `CHANGELOG.md` with `## X.Y.Z` version sections —
 * the invariant a fleet `release-guard` checks with `^## <version>`.
 */
export declare function changelogTarget(options?: ChangelogTargetOptions): ReleaseNotesTarget;
