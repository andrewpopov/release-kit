"use strict";
/**
 * Internal filesystem snapshot/restore plumbing shared by the manifest
 * adapter (`manifest.ts`) and the built-in notes targets (`notes-target.ts`),
 * so `cutRelease` (`publish.ts`) can roll every file a cut touches back to
 * its exact pre-cut bytes if a later step (publish, archive, validation)
 * fails. Not part of the public API — `index.ts` does not re-export this
 * module.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NOOP_GUARD = void 0;
exports.describeError = describeError;
exports.snapshotFile = snapshotFile;
exports.snapshotDirectory = snapshotDirectory;
exports.combineRestores = combineRestores;
exports.rollbackOnFailure = rollbackOnFailure;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
function describeError(error) {
    return error instanceof Error ? error.message : String(error);
}
function captureFileState(filePath) {
    const existed = node_fs_1.default.existsSync(filePath);
    return { existed, content: existed ? node_fs_1.default.readFileSync(filePath) : undefined };
}
function fileStatesEqual(left, right) {
    if (left.existed !== right.existed) {
        return false;
    }
    return !left.existed || left.content.equals(right.content);
}
function applyFileState(filePath, state) {
    if (state.existed) {
        node_fs_1.default.mkdirSync(node_path_1.default.dirname(filePath), { recursive: true });
        node_fs_1.default.writeFileSync(filePath, state.content);
    }
    else if (node_fs_1.default.existsSync(filePath)) {
        node_fs_1.default.rmSync(filePath);
    }
}
/** A `Guard` that does nothing — used where a snapshot function is optional and wasn't provided. */
exports.NOOP_GUARD = { commit() { }, restore: () => [] };
/**
 * Captures `filePath`'s current bytes (or its absence) and returns a
 * `Guard` that can later restore exactly that state — rewrites the original
 * bytes if the file existed, or removes it if it didn't — but only when
 * doing so won't destroy a concurrent write (see `Guard`'s doc comment).
 * Safe to call the returned `restore` even if `filePath` was never actually
 * touched (e.g. the mutation that would have touched it never ran).
 */
function snapshotFile(filePath) {
    const before = captureFileState(filePath);
    let ours;
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
function snapshotDirectory(dirPath) {
    const missing = [];
    let current = node_path_1.default.resolve(dirPath);
    while (!node_fs_1.default.existsSync(current)) {
        missing.push(current);
        const parent = node_path_1.default.dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }
    return () => {
        for (const dir of missing) {
            try {
                if (node_fs_1.default.existsSync(dir) && node_fs_1.default.readdirSync(dir).length === 0) {
                    node_fs_1.default.rmdirSync(dir);
                }
            }
            catch {
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
function combineRestores(restores) {
    return () => {
        const errors = [];
        const skipped = [];
        for (const restore of [...restores].reverse()) {
            try {
                skipped.push(...restore());
            }
            catch (error) {
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
function rollbackOnFailure(restore, error) {
    const originalMessage = describeError(error);
    let skipped;
    try {
        skipped = restore();
    }
    catch (rollbackError) {
        throw new Error(`${originalMessage}\n\nAdditionally, rolling back after this failure also failed — the working tree may be ` +
            `left partially mutated: ${describeError(rollbackError)}`);
    }
    if (skipped.length > 0) {
        throw new Error(`${originalMessage}\n\nRollback left ${skipped.length} path(s) unchanged instead of restoring them, because ` +
            'their contents changed after release-kit wrote them and restoring would have discarded that change:\n' +
            skipped.map((line) => `  - ${line}`).join('\n'));
    }
    throw error instanceof Error ? error : new Error(originalMessage);
}
