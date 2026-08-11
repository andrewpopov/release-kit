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
import type { Guard } from './fs-snapshot';
export interface ReleaseNotesPublishContext {
    version: string;
    date: string;
    commit: string;
    fragments: Fragment[];
}
export interface ReleaseNotesTarget {
    /**
     * Write the version's notes into the target and consume its fragments.
     * Returns the written file path AND the immutable artifact content for
     * THIS release: `content` is the rendered notes for `ctx.version` alone
     * (never the whole file a target may share across versions, e.g.
     * `changelogTarget`'s cumulative `CHANGELOG.md`), and `date` is the date
     * the target actually rendered with (`ctx.date`), not something a caller
     * has to re-derive by re-parsing the written file. `createReleaseArtifactV1`
     * uses these directly instead of re-parsing `releasePath` — re-parsing is
     * what let a target-specific file shape (no `Release date:` line, notes for
     * every historical version) leak into the "one release" artifact (PKG-140
     * finding 3).
     */
    publish(config: ReleaseKitConfig, ctx: ReleaseNotesPublishContext, options: {
        force?: boolean;
    }): {
        releasePath: string;
        content: string;
        date: string;
    };
    /** Return validation error strings for the target's state at `version` (empty array = ok). */
    validate(config: ReleaseKitConfig, version: string): string[];
    /** Returns whether `version`'s notes already exist in the target (checked pre-mutation by `preflightCut`). */
    hasVersion(config: ReleaseKitConfig, version: string): boolean;
    /**
     * Optional rollback support, mirroring `VersionManifestAdapter.snapshot`.
     * Snapshots every file `publish(config, ctx, ...)` would touch for this
     * `ctx` (the output file/index AND the fragment files `ctx.fragments`
     * names, which `publish` moves from `unreleased/` into `archive/<version>/`)
     * and returns a `Guard`. `cutRelease` calls this BEFORE `publish`, calls
     * the guard's `commit()` right after `publish` returns successfully, and
     * invokes `restore()` if a LATER step (validation) fails — restoring
     * every touched file byte-for-byte, including putting moved fragments
     * back at their original location, EXCEPT a file whose current contents
     * no longer match what `commit()` observed: that one is left alone and
     * reported instead of clobbered, since something else must have legitimately
     * changed it since (PKG-140 finding B). Both built-in targets implement
     * it; a custom target that doesn't is skipped by `cutRelease` — best
     * effort, not required.
     */
    snapshot?(config: ReleaseKitConfig, ctx: ReleaseNotesPublishContext): Guard;
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
