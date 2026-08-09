"use strict";
/**
 * Release-hygiene classification — ported byte-for-byte from rouge's
 * `scripts/check-release-hygiene.js`. The classification LISTS come from
 * `config.hygiene`; the algorithm (git diff collection, path matching) is
 * generic.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectChangedFiles = collectChangedFiles;
exports.isPatchNoteArtifact = isPatchNoteArtifact;
exports.isReleaseRelevantFile = isReleaseRelevantFile;
exports.classifyReleaseHygiene = classifyReleaseHygiene;
exports.checkReleaseHygiene = checkReleaseHygiene;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
const config_1 = require("./config");
const fragments_1 = require("./fragments");
function normalizePath(filePath) {
    return String(filePath || '')
        .trim()
        .replace(/\\/g, '/')
        .replace(/^\.\//, '');
}
function uniqueSorted(values) {
    return [...new Set(values.map(normalizePath).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}
function gitLines(rootDir, args) {
    try {
        const output = (0, node_child_process_1.execFileSync)('git', args, {
            cwd: rootDir,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 10000,
        });
        return output
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
    }
    catch {
        return [];
    }
}
function resolveDiffBase(rootDir, baseRef) {
    const ref = String(baseRef || '').trim();
    if (!ref) {
        return '';
    }
    const mergeBase = gitLines(rootDir, ['merge-base', 'HEAD', ref]);
    return mergeBase[0] || '';
}
function collectChangedFiles(rootDir, baseRef) {
    const files = [];
    const diffBase = resolveDiffBase(rootDir, baseRef);
    if (diffBase) {
        files.push(...gitLines(rootDir, ['diff', '--name-only', `${diffBase}...HEAD`]));
    }
    files.push(...gitLines(rootDir, ['diff', '--name-only', '--cached']));
    files.push(...gitLines(rootDir, ['diff', '--name-only']));
    files.push(...gitLines(rootDir, ['ls-files', '--others', '--exclude-standard']));
    return uniqueSorted(files);
}
function isFragmentFileName(filePath) {
    const fileName = node_path_1.default.posix.basename(filePath);
    return fileName.endsWith('.md') && fileName !== 'README.md' && !fileName.startsWith('_');
}
function isPatchNoteArtifact(config, filePath) {
    const normalized = normalizePath(filePath);
    if (!isFragmentFileName(normalized)) {
        return false;
    }
    return (normalized.startsWith(`${(0, config_1.notesDirPosix)(config)}/unreleased/`) ||
        normalized.startsWith(`${(0, config_1.notesDirPosix)(config)}/releases/`) ||
        // A cut moves consumed fragments into archive/<version>/ (see
        // archiveConsumedFragments in notes-target.ts) and empties unreleased/ —
        // it's the same fragment file, just relocated, so it still counts as the
        // patch-note artifact. Without this, no release branch can ever pass.
        normalized.startsWith(`${(0, config_1.archiveDirPosix)(config)}/`));
}
function isReleaseRelevantFile(config, filePath) {
    const normalized = normalizePath(filePath);
    if (!normalized || isPatchNoteArtifact(config, normalized)) {
        return false;
    }
    const { relevantFiles, relevantDocFiles, relevantPrefixes, relevantScriptPrefixes } = config.hygiene;
    if (relevantFiles.includes(normalized) || relevantDocFiles.includes(normalized)) {
        return true;
    }
    if (relevantPrefixes.some((prefix) => normalized.startsWith(prefix))) {
        return true;
    }
    return relevantScriptPrefixes.some((prefix) => normalized.startsWith(prefix));
}
/**
 * Reads a changed patch-note fragment's body off disk, or `undefined` if it
 * can't be read — deleted by this change, or not a well-formed fragment.
 * Either way there is nothing to validate, so callers should skip it rather
 * than fail hygiene on it (full front-matter validation is `check`/
 * `publish`'s job, not hygiene's).
 */
function readChangedFragmentBody(rootDir, relativeFilePath) {
    const absolutePath = node_path_1.default.resolve(rootDir, relativeFilePath);
    if (!node_fs_1.default.existsSync(absolutePath)) {
        return undefined;
    }
    try {
        return (0, fragments_1.parseFrontMatter)(node_fs_1.default.readFileSync(absolutePath, 'utf8'), relativeFilePath).body;
    }
    catch {
        return undefined;
    }
}
function classifyReleaseHygiene(config, changedFiles) {
    const normalizedChangedFiles = uniqueSorted(changedFiles || []);
    const patchNoteFiles = normalizedChangedFiles.filter((file) => isPatchNoteArtifact(config, file));
    const relevantFiles = normalizedChangedFiles.filter((file) => isReleaseRelevantFile(config, file));
    const requiresPatchNote = relevantFiles.length > 0;
    const hasPatchNoteUpdate = patchNoteFiles.length > 0;
    const rootDir = node_path_1.default.resolve(config.rootDir);
    const placeholderPatchNoteFiles = patchNoteFiles.filter((file) => {
        const body = readChangedFragmentBody(rootDir, file);
        return body !== undefined && (0, fragments_1.isPlaceholderBody)(config, body);
    });
    return {
        ok: (!requiresPatchNote || hasPatchNoteUpdate) && placeholderPatchNoteFiles.length === 0,
        changedFiles: normalizedChangedFiles,
        hasPatchNoteUpdate,
        patchNoteFiles,
        relevantFiles,
        requiresPatchNote,
        placeholderPatchNoteFiles,
    };
}
function checkReleaseHygiene(config, options = {}) {
    const rootDir = node_path_1.default.resolve(config.rootDir);
    const baseRef = options.baseRef || config.hygiene.baseRef;
    return classifyReleaseHygiene(config, collectChangedFiles(rootDir, baseRef));
}
