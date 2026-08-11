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
exports.DEFAULT_HYGIENE_EXCLUDE_PATTERNS = exports.HygieneGitError = void 0;
exports.collectChangedFiles = collectChangedFiles;
exports.isPatchNoteArtifact = isPatchNoteArtifact;
exports.matchesHygieneExcludePattern = matchesHygieneExcludePattern;
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
class HygieneGitError extends Error {
    constructor(kind, message) {
        super(message);
        this.name = 'HygieneGitError';
        this.kind = kind;
    }
}
exports.HygieneGitError = HygieneGitError;
/** Classifies a failed `execFileSync('git', args, ...)` call for `runGit`'s callers (i.e. every git invocation except `merge-base`, which needs its own ref-aware classification — see `resolveDiffBase`). */
function classifyGitFailure(error, args) {
    const err = error;
    const command = `git ${args.join(' ')}`;
    if (err && err.code === 'ENOENT') {
        return new HygieneGitError('git-unavailable', `Release hygiene could not run \`${command}\`: the \`git\` executable was not found on PATH. Install git ` +
            '(or make sure it is on PATH) in whatever environment runs `release-kit hygiene` — the gate cannot check ' +
            'anything without it.');
    }
    const stderr = String(err?.stderr || '').trim();
    if (/not a git repository/i.test(stderr)) {
        return new HygieneGitError('not-a-git-repo', `Release hygiene could not run \`${command}\`: this directory is not inside a git repository (or its .git ` +
            'history was not included in the checkout). Run `release-kit hygiene` from within a git checkout of the repo.');
    }
    return new HygieneGitError('git-command-failed', `Release hygiene could not run \`${command}\`: ${stderr || err?.message || 'the git command failed for an unknown reason'}`);
}
function runGit(rootDir, args) {
    try {
        return (0, node_child_process_1.execFileSync)('git', args, {
            cwd: rootDir,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 10000,
        });
    }
    catch (error) {
        throw classifyGitFailure(error, args);
    }
}
function gitLines(rootDir, args) {
    return runGit(rootDir, args)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
}
/** Best-effort hint only for the `insufficient-history` message — never lets a failure here mask the primary git error. */
function isShallowRepo(rootDir) {
    try {
        return ((0, node_child_process_1.execFileSync)('git', ['rev-parse', '--is-shallow-repository'], {
            cwd: rootDir,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 10000,
        }).trim() === 'true');
    }
    catch {
        return false;
    }
}
/**
 * Resolves the merge-base commit `HEAD` diffs against, or `''` when `baseRef`
 * isn't configured (an explicit, existing opt-out — see `HygieneConfig.baseRef`'s
 * doc comment). A CONFIGURED ref that can't be resolved always throws: `git
 * merge-base`'s own exit-code contract distinguishes the two failure shapes
 * cleanly (per `git help merge-base`: status 1 means "no common ancestor
 * found", anything else is a hard error), so `status === 1` maps to
 * `insufficient-history` (the classic shallow-checkout shape: both refs exist
 * but share no history in THIS checkout) and everything else maps to
 * `base-ref-not-found` (bad ref name, or a ref never fetched into this
 * checkout — the two are not reliably distinguishable from git's error text
 * alone, so the message names both possible causes).
 */
function resolveDiffBase(rootDir, baseRef) {
    const ref = String(baseRef || '').trim();
    if (!ref) {
        return '';
    }
    const args = ['merge-base', 'HEAD', ref];
    try {
        const output = (0, node_child_process_1.execFileSync)('git', args, {
            cwd: rootDir,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 10000,
        });
        return (output
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)[0] || '');
    }
    catch (error) {
        const err = error;
        if (err && (err.code === 'ENOENT' || /not a git repository/i.test(String(err.stderr || '')))) {
            throw classifyGitFailure(error, args);
        }
        if (err && err.status === 1) {
            const shallow = isShallowRepo(rootDir);
            throw new HygieneGitError('insufficient-history', `Release hygiene could not find a common ancestor between HEAD and base ref "${ref}" — ${shallow
                ? 'this checkout is shallow, so the history needed to compute the diff is missing.'
                : 'the two histories share no common commit reachable from this checkout.'} Fetch full history before running hygiene (e.g. \`actions/checkout\` with \`fetch-depth: 0\`, or \`git fetch --unshallow\`), or confirm "${ref}" is the right base ref.`);
        }
        const stderr = String(err?.stderr || '').trim();
        throw new HygieneGitError('base-ref-not-found', `Release hygiene could not resolve base ref "${ref}": ${stderr || err?.message || 'git merge-base failed'}. ` +
            `Verify the ref name, and that it has been fetched into this checkout — a shallow CI checkout (the default ` +
            `on most providers) usually fetches only the current branch. Fetch the base ref too, or use \`fetch-depth: 0\`.`);
    }
}
/**
 * Collects the changed-file set hygiene classifies against. FAILS CLOSED:
 * any git failure (missing binary, not a repo, an unresolvable base ref,
 * insufficient history) throws a `HygieneGitError` instead of degrading to
 * an empty (falsely-passing) result — see `checkReleaseHygiene` for the one
 * explicit, opt-in way to downgrade a base-ref failure instead of failing.
 */
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
/**
 * Default `hygiene.excludePatterns` — test files. Every consuming repo's
 * `relevantPrefixes` (e.g. `packages/web-app/src/`) sweeps in test files
 * living under the same tree (`src/**\/__tests__/**`, `*.test.ts`,
 * `*.spec.tsx`), so a change that adds ONLY tests was classified
 * release-relevant and blocked at push time for a change no user can
 * observe (PTRY-524).
 */
exports.DEFAULT_HYGIENE_EXCLUDE_PATTERNS = ['**/__tests__/**', '**/__mocks__/**', '*.test.*', '*.spec.*'];
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/**
 * Converts a small glob subset (`**` = any number of path segments including
 * zero, `*` = any characters within one segment) to a RegExp. Handles a
 * leading `**` + `/` and a trailing `/` + `**` specially so a pattern like
 * `**` + `/__tests__/` + `**` also matches `__tests__/foo.ts` at the root
 * (zero leading/trailing segments) — a plain `**` -> `.*` substitution would
 * require a literal `/` on both sides and miss that case.
 */
function globToRegExp(glob) {
    let body = glob;
    let optionalPrefix = false;
    let optionalSuffix = false;
    if (body.startsWith('**/')) {
        optionalPrefix = true;
        body = body.slice(3);
    }
    if (body.endsWith('/**')) {
        optionalSuffix = true;
        body = body.slice(0, -3);
    }
    const DOUBLE_STAR = ' DOUBLE_STAR ';
    const SINGLE_STAR = ' SINGLE_STAR ';
    const tokenized = body.split('**').join(DOUBLE_STAR).split('*').join(SINGLE_STAR);
    const escaped = escapeRegExp(tokenized).split(DOUBLE_STAR).join('.*').split(SINGLE_STAR).join('[^/]*');
    const prefix = optionalPrefix ? '(?:.*/)?' : '';
    const suffix = optionalSuffix ? '(?:/.*)?' : '';
    return new RegExp(`^${prefix}${escaped}${suffix}$`);
}
/**
 * Whether `normalizedPath` matches a single `excludePatterns` glob. A
 * pattern containing `/` is matched against the full normalized path (it
 * names a directory shape, e.g. `**\/__tests__/**`); a pattern with no `/` is
 * matched against the basename only (it names a filename shape, e.g.
 * `*.test.*`), the same convention `.gitignore` uses — otherwise a bare
 * `*.test.*` could only ever match a file living at the repo root.
 */
function matchesHygieneExcludePattern(pattern, normalizedPath) {
    const target = pattern.includes('/') ? normalizedPath : node_path_1.default.posix.basename(normalizedPath);
    return globToRegExp(pattern).test(target);
}
function isExcludedFromRelevance(config, normalizedPath) {
    const patterns = config.hygiene.excludePatterns ?? exports.DEFAULT_HYGIENE_EXCLUDE_PATTERNS;
    return patterns.some((pattern) => matchesHygieneExcludePattern(pattern, normalizedPath));
}
function isReleaseRelevantFile(config, filePath) {
    const normalized = normalizePath(filePath);
    if (!normalized || isPatchNoteArtifact(config, normalized)) {
        return false;
    }
    const { relevantFiles, relevantDocFiles, relevantPrefixes, relevantScriptPrefixes } = config.hygiene;
    // Exact, curated file lists are a deliberate opt-in by the repo owner — a
    // default exclude pattern must never override that, so exclusion is
    // checked only for the broad prefix matches below (see the `excludePatterns`
    // doc comment on `HygieneConfig` for the full reasoning).
    if (relevantFiles.includes(normalized) || relevantDocFiles.includes(normalized)) {
        return true;
    }
    const matchesPrefix = relevantPrefixes.some((prefix) => normalized.startsWith(prefix)) ||
        relevantScriptPrefixes.some((prefix) => normalized.startsWith(prefix));
    return matchesPrefix && !isExcludedFromRelevance(config, normalized);
}
/**
 * Reads a changed patch-note fragment's summary/body off disk, or
 * `undefined` if it can't be read — deleted by this change, or not a
 * well-formed fragment. Either way there is nothing to validate, so callers
 * should skip it rather than fail hygiene on it (full front-matter
 * validation, e.g. kind/presence checks, is `check`/`publish`'s job, not
 * hygiene's).
 */
function readChangedFragmentContent(rootDir, relativeFilePath) {
    const absolutePath = node_path_1.default.resolve(rootDir, relativeFilePath);
    if (!node_fs_1.default.existsSync(absolutePath)) {
        return undefined;
    }
    try {
        const { meta, body } = (0, fragments_1.parseFrontMatter)(node_fs_1.default.readFileSync(absolutePath, 'utf8'), relativeFilePath);
        return { summary: (0, fragments_1.extractSummary)(meta), body };
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
    const changedFragmentIssues = patchNoteFiles.map((file) => {
        const content = readChangedFragmentContent(rootDir, file);
        return { file, issues: content ? (0, fragments_1.validateFragmentContent)(config, content) : [] };
    });
    const placeholderPatchNoteFiles = changedFragmentIssues
        .filter(({ issues }) => issues.some((issue) => issue.code === 'placeholder-body'))
        .map(({ file }) => file);
    const trailingPeriodSummaryPatchNoteFiles = changedFragmentIssues
        .filter(({ issues }) => issues.some((issue) => issue.code === 'trailing-period-summary'))
        .map(({ file }) => file);
    return {
        ok: (!requiresPatchNote || hasPatchNoteUpdate) &&
            placeholderPatchNoteFiles.length === 0 &&
            trailingPeriodSummaryPatchNoteFiles.length === 0,
        changedFiles: normalizedChangedFiles,
        hasPatchNoteUpdate,
        patchNoteFiles,
        relevantFiles,
        requiresPatchNote,
        placeholderPatchNoteFiles,
        trailingPeriodSummaryPatchNoteFiles,
        warnings: [],
    };
}
function checkReleaseHygiene(config, options = {}) {
    const rootDir = node_path_1.default.resolve(config.rootDir);
    const baseRef = options.baseRef || config.hygiene.baseRef;
    const allowMissingHistory = options.allowMissingHistory || config.hygiene.allowMissingHistory || false;
    const warnings = [];
    let changedFiles;
    try {
        changedFiles = collectChangedFiles(rootDir, baseRef);
    }
    catch (error) {
        if (allowMissingHistory &&
            error instanceof HygieneGitError &&
            (error.kind === 'base-ref-not-found' || error.kind === 'insufficient-history')) {
            warnings.push(`hygiene.allowMissingHistory is set: continuing WITHOUT a base-ref comparison against "${baseRef}" (${error.message}). ` +
                'Only working-tree, staged, and untracked changes are checked — commits already on this branch relative to ' +
                'the base ref are NOT covered by this run. Fix the underlying history problem when you can.');
            changedFiles = collectChangedFiles(rootDir, '');
        }
        else {
            throw error;
        }
    }
    return { ...classifyReleaseHygiene(config, changedFiles), warnings };
}
