/**
 * Internal filesystem snapshot/restore plumbing shared by the manifest
 * adapter (`manifest.ts`) and the built-in notes targets (`notes-target.ts`),
 * so `cutRelease` (`publish.ts`) can roll every file a cut touches back to
 * its exact pre-cut bytes if a later step (publish, archive, validation)
 * fails. Not part of the public API — `index.ts` does not re-export this
 * module.
 */
/** Undoes exactly one snapshot taken earlier. Idempotent: calling it more than once is safe. */
export type Restore = () => void;
export declare function describeError(error: unknown): string;
/**
 * Captures `filePath`'s current bytes (or its absence) and returns a
 * function that restores exactly that state — rewrites the original bytes
 * if the file existed, or removes it if it didn't. Safe to call the restore
 * function even if `filePath` was never actually touched (e.g. the mutation
 * that would have touched it never ran).
 */
export declare function snapshotFile(filePath: string): Restore;
/**
 * Combines independent restore functions into one. Runs ALL of them (in
 * reverse of the given order — undo the most recently captured mutation
 * first) even if one throws, so a single failing restore can't skip the
 * rest; aggregates every failure into one error instead of silently
 * dropping any of them.
 */
export declare function combineRestores(restores: Restore[]): Restore;
/**
 * Runs `restore()` after `error`, then re-throws. If `restore()` itself
 * throws, the rollback failure is APPENDED to (never replaces) the original
 * error — the original is always primary, so a broken rollback can't mask
 * the failure that triggered it.
 */
export declare function rollbackOnFailure(restore: Restore, error: unknown): never;
