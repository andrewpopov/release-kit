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

/** Undoes exactly one snapshot taken earlier. Idempotent: calling it more than once is safe. */
export type Restore = () => void;

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Captures `filePath`'s current bytes (or its absence) and returns a
 * function that restores exactly that state — rewrites the original bytes
 * if the file existed, or removes it if it didn't. Safe to call the restore
 * function even if `filePath` was never actually touched (e.g. the mutation
 * that would have touched it never ran).
 */
export function snapshotFile(filePath: string): Restore {
  const existed = fs.existsSync(filePath);
  const content = existed ? fs.readFileSync(filePath) : undefined;
  return () => {
    if (existed) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content as Buffer);
    } else if (fs.existsSync(filePath)) {
      fs.rmSync(filePath);
    }
  };
}

/**
 * Combines independent restore functions into one. Runs ALL of them (in
 * reverse of the given order — undo the most recently captured mutation
 * first) even if one throws, so a single failing restore can't skip the
 * rest; aggregates every failure into one error instead of silently
 * dropping any of them.
 */
export function combineRestores(restores: Restore[]): Restore {
  return () => {
    const errors: unknown[] = [];
    for (const restore of [...restores].reverse()) {
      try {
        restore();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new Error(`Rollback failed for ${errors.length} file(s): ${errors.map(describeError).join('; ')}`);
    }
  };
}

/**
 * Runs `restore()` after `error`, then re-throws. If `restore()` itself
 * throws, the rollback failure is APPENDED to (never replaces) the original
 * error — the original is always primary, so a broken rollback can't mask
 * the failure that triggered it.
 */
export function rollbackOnFailure(restore: Restore, error: unknown): never {
  const originalMessage = describeError(error);
  try {
    restore();
  } catch (rollbackError) {
    throw new Error(
      `${originalMessage}\n\nAdditionally, rolling back after this failure also failed — the working tree may be ` +
        `left partially mutated: ${describeError(rollbackError)}`,
    );
  }
  throw error instanceof Error ? error : new Error(originalMessage);
}
