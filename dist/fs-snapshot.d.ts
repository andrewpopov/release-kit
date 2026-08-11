/**
 * Internal filesystem snapshot/restore plumbing shared by the manifest
 * adapter (`manifest.ts`) and the built-in notes targets (`notes-target.ts`),
 * so `cutRelease` (`publish.ts`) can roll every file a cut touches back to
 * its exact pre-cut bytes if a later step (publish, archive, validation)
 * fails. Not part of the public API — `index.ts` does not re-export this
 * module.
 */
export declare function describeError(error: unknown): string;
/**
 * Runs a rollback step and returns descriptions of any path it deliberately
 * left unchanged (see `Guard`) instead of restoring — never a description of
 * what it successfully restored, since that's the normal, silent case.
 * Idempotent: calling the same `Restore` more than once is safe.
 */
export type Restore = () => string[];
/**
 * A two-phase, conflict-aware guard over one file (PKG-140 finding B).
 * `commit()` marks "this is what WE (the cut) put here"; `restore()` later
 * undoes it, but ONLY if the file's current bytes still match what commit()
 * observed — a legitimate concurrent write landing after our commit is
 * never clobbered, just skipped and reported. If `commit()` was never
 * called (our own write never happened, or failed before completing),
 * `restore()` falls back to unconditionally restoring the pre-mutation
 * state: there is no "ours" yet for a concurrent writer to have raced
 * against, so the plain, byte-for-byte rollback this package has always
 * done is exactly right.
 */
export interface Guard {
    /**
     * Records the file's CURRENT bytes/absence as "ours". Call this once,
     * immediately after the write this guard is watching has actually
     * completed — never before, and never if that write didn't happen.
     */
    commit(): void;
    /** See `Restore`. */
    restore: Restore;
}
/** A `Guard` that does nothing — used where a snapshot function is optional and wasn't provided. */
export declare const NOOP_GUARD: Guard;
/**
 * Captures `filePath`'s current bytes (or its absence) and returns a
 * `Guard` that can later restore exactly that state — rewrites the original
 * bytes if the file existed, or removes it if it didn't — but only when
 * doing so won't destroy a concurrent write (see `Guard`'s doc comment).
 * Safe to call the returned `restore` even if `filePath` was never actually
 * touched (e.g. the mutation that would have touched it never ran).
 */
export declare function snapshotFile(filePath: string): Guard;
/**
 * Records which directories along `dirPath`'s chain do NOT exist yet — the
 * ones an upcoming `fs.mkdirSync(dirPath, { recursive: true })` is about to
 * create — and returns a `Restore` that removes them again, deepest first,
 * but ONLY the ones this snapshot found missing (never a directory that
 * already existed before the operation — that one isn't this operation's to
 * remove) and ONLY if each is still empty by the time restore runs (a
 * directory that ended up holding something — ours or anyone else's — is
 * left alone; git doesn't track empty directories, so leaving one behind on
 * a failed restore is a residue problem, not a data-loss one, so this never
 * needs the conflict-aware treatment `Guard` gives file content — PKG-140
 * finding D).
 */
export declare function snapshotDirectory(dirPath: string): Restore;
/**
 * Combines independent restore steps into one. Runs ALL of them (in reverse
 * of the given order — undo the most recently captured mutation first) even
 * if one throws, so a single failing restore can't skip the rest;
 * aggregates every failure into one error instead of silently dropping any
 * of them, and passes through every skipped-path description any step
 * reports (see `Guard`/`Restore`).
 */
export declare function combineRestores(restores: Restore[]): Restore;
/**
 * Runs `restore()` after `error`, then re-throws. If `restore()` itself
 * throws, the rollback failure is APPENDED to (never replaces) the original
 * error — the original is always primary, so a broken rollback can't mask
 * the failure that triggered it. If `restore()` succeeds but had to skip
 * some paths (PKG-140 finding B — a concurrent write it wouldn't be safe to
 * discard), that's likewise appended so the operator learns which paths
 * were deliberately left alone and why, instead of the failure silently
 * saying "rolled back" when it didn't fully.
 */
export declare function rollbackOnFailure(restore: Restore, error: unknown): never;
