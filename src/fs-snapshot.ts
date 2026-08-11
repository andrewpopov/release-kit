/**
 * Internal filesystem snapshot/restore plumbing shared by the manifest
 * adapter (`manifest.ts`) and the built-in notes targets (`notes-target.ts`),
 * so `cutRelease` (`publish.ts`) can roll every file a cut touches back to
 * its exact pre-cut bytes if a later step (publish, archive, validation)
 * fails. Not part of the public API — `index.ts` does not re-export this
 * module.
 */

import fs from 'node:fs';
import path from 'node:path';

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs a rollback step and returns descriptions of any path it deliberately
 * left unchanged (see `Guard`) instead of restoring — never a description of
 * what it successfully restored, since that's the normal, silent case.
 * Idempotent: calling the same `Restore` more than once is safe.
 */
export type Restore = () => string[];

interface FileState {
  existed: boolean;
  content?: Buffer;
}

function captureFileState(filePath: string): FileState {
  const existed = fs.existsSync(filePath);
  return { existed, content: existed ? fs.readFileSync(filePath) : undefined };
}

function fileStatesEqual(left: FileState, right: FileState): boolean {
  if (left.existed !== right.existed) {
    return false;
  }
  return !left.existed || (left.content as Buffer).equals(right.content as Buffer);
}

function applyFileState(filePath: string, state: FileState): void {
  if (state.existed) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, state.content as Buffer);
  } else if (fs.existsSync(filePath)) {
    fs.rmSync(filePath);
  }
}

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
export const NOOP_GUARD: Guard = { commit() {}, restore: () => [] };

/**
 * Captures `filePath`'s current bytes (or its absence) and returns a
 * `Guard` that can later restore exactly that state — rewrites the original
 * bytes if the file existed, or removes it if it didn't — but only when
 * doing so won't destroy a concurrent write (see `Guard`'s doc comment).
 * Safe to call the returned `restore` even if `filePath` was never actually
 * touched (e.g. the mutation that would have touched it never ran).
 */
export function snapshotFile(filePath: string): Guard {
  const before = captureFileState(filePath);
  let ours: FileState | undefined;
  return {
    commit() {
      ours = captureFileState(filePath);
    },
    restore() {
      const current = captureFileState(filePath);
      if (ours && !fileStatesEqual(current, ours)) {
        return [
          `${filePath} (its contents changed after release-kit wrote them — left exactly as found, not rolled back, ` +
            'to avoid discarding that change)',
        ];
      }
      applyFileState(filePath, before);
      return [];
    },
  };
}

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
export function snapshotDirectory(dirPath: string): Restore {
  const missing: string[] = [];
  let current = path.resolve(dirPath);
  while (!fs.existsSync(current)) {
    missing.push(current);
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return () => {
    for (const dir of missing) {
      try {
        if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
          fs.rmdirSync(dir);
        }
      } catch {
        // Best-effort tidy-up only — see the doc comment above. A directory
        // that can't be removed is left behind, which is never a data-loss
        // risk the way a file restore is.
      }
    }
    return [];
  };
}

/**
 * Combines independent restore steps into one. Runs ALL of them (in reverse
 * of the given order — undo the most recently captured mutation first) even
 * if one throws, so a single failing restore can't skip the rest;
 * aggregates every failure into one error instead of silently dropping any
 * of them, and passes through every skipped-path description any step
 * reports (see `Guard`/`Restore`).
 */
export function combineRestores(restores: Restore[]): Restore {
  return () => {
    const errors: unknown[] = [];
    const skipped: string[] = [];
    for (const restore of [...restores].reverse()) {
      try {
        skipped.push(...restore());
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      const skippedNote = skipped.length > 0 ? ` Also left unchanged (see below) rather than restored: ${skipped.join('; ')}.` : '';
      throw new Error(`Rollback failed for ${errors.length} file(s): ${errors.map(describeError).join('; ')}.${skippedNote}`);
    }
    return skipped;
  };
}

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
export function rollbackOnFailure(restore: Restore, error: unknown): never {
  const originalMessage = describeError(error);
  let skipped: string[];
  try {
    skipped = restore();
  } catch (rollbackError) {
    throw new Error(
      `${originalMessage}\n\nAdditionally, rolling back after this failure also failed — the working tree may be ` +
        `left partially mutated: ${describeError(rollbackError)}`,
    );
  }
  if (skipped.length > 0) {
    throw new Error(
      `${originalMessage}\n\nRollback left ${skipped.length} path(s) unchanged instead of restoring them, because ` +
        'their contents changed after release-kit wrote them and restoring would have discarded that change:\n' +
        skipped.map((line) => `  - ${line}`).join('\n'),
    );
  }
  throw error instanceof Error ? error : new Error(originalMessage);
}
