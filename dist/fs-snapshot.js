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
exports.describeError = describeError;
exports.snapshotFile = snapshotFile;
exports.combineRestores = combineRestores;
exports.rollbackOnFailure = rollbackOnFailure;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
function describeError(error) {
    return error instanceof Error ? error.message : String(error);
}
/**
 * Captures `filePath`'s current bytes (or its absence) and returns a
 * function that restores exactly that state — rewrites the original bytes
 * if the file existed, or removes it if it didn't. Safe to call the restore
 * function even if `filePath` was never actually touched (e.g. the mutation
 * that would have touched it never ran).
 */
function snapshotFile(filePath) {
    const existed = node_fs_1.default.existsSync(filePath);
    const content = existed ? node_fs_1.default.readFileSync(filePath) : undefined;
    return () => {
        if (existed) {
            node_fs_1.default.mkdirSync(node_path_1.default.dirname(filePath), { recursive: true });
            node_fs_1.default.writeFileSync(filePath, content);
        }
        else if (node_fs_1.default.existsSync(filePath)) {
            node_fs_1.default.rmSync(filePath);
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
function combineRestores(restores) {
    return () => {
        const errors = [];
        for (const restore of [...restores].reverse()) {
            try {
                restore();
            }
            catch (error) {
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
function rollbackOnFailure(restore, error) {
    const originalMessage = describeError(error);
    try {
        restore();
    }
    catch (rollbackError) {
        throw new Error(`${originalMessage}\n\nAdditionally, rolling back after this failure also failed — the working tree may be ` +
            `left partially mutated: ${describeError(rollbackError)}`);
    }
    throw error instanceof Error ? error : new Error(originalMessage);
}
