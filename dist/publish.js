"use strict";
/**
 * Publish/validate flow — ported byte-for-byte from rouge's
 * `scripts/lib/release-notes-core.js`. STRICT PARITY for v0.1.0: this
 * replicates rouge's exact current write order (release file -> archive
 * copies -> delete unreleased -> refresh index) with NO transactional
 * rollback. That hardening is deferred to v0.1.1 (see the extraction plan).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectFragments = void 0;
exports.resolveVersion = resolveVersion;
exports.nextVersion = nextVersion;
exports.getGitShortSha = getGitShortSha;
exports.bumpVersion = bumpVersion;
exports.listReleaseSummaries = listReleaseSummaries;
exports.updatePatchNotesIndex = updatePatchNotesIndex;
exports.publishRelease = publishRelease;
exports.validateReleaseState = validateReleaseState;
exports.cutRelease = cutRelease;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
const config_1 = require("./config");
const fragments_1 = require("./fragments");
const render_1 = require("./render");
var fragments_2 = require("./fragments");
Object.defineProperty(exports, "collectFragments", { enumerable: true, get: function () { return fragments_2.collectFragments; } });
function tryStep(errors, fn, fallback, prefix = '') {
    try {
        return fn();
    }
    catch (error) {
        errors.push(`${prefix}${error instanceof Error ? error.message : String(error)}`);
        return fallback;
    }
}
/** Returns `explicitVersion` trimmed, or the manifest's current version. */
function resolveVersion(config, explicitVersion) {
    const rootDir = node_path_1.default.resolve(config.rootDir);
    return String(explicitVersion || config.manifest.readVersion(rootDir)).trim();
}
/** Returns `explicitVersion` trimmed, or the strategy's next version after the manifest's current version. */
function nextVersion(config, explicitVersion) {
    const previousVersion = resolveVersion(config);
    return String(explicitVersion || config.versionStrategy.next(previousVersion)).trim();
}
/** Shells out to `git rev-parse --short HEAD`; returns `""` if unavailable. */
function getGitShortSha(rootDir) {
    try {
        return String((0, node_child_process_1.execFileSync)('git', ['rev-parse', '--short', 'HEAD'], {
            cwd: rootDir,
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 5000,
        })).trim();
    }
    catch {
        return '';
    }
}
function bumpVersion(config, options = {}) {
    const rootDir = node_path_1.default.resolve(config.rootDir);
    const previousVersion = config.manifest.readVersion(rootDir);
    const version = String(options.version || config.versionStrategy.next(previousVersion)).trim();
    config.manifest.writeVersion(rootDir, version);
    return { previousVersion, version };
}
function listReleaseSummaries(config) {
    const { releasesDir } = (0, config_1.resolvePaths)(config);
    if (!node_fs_1.default.existsSync(releasesDir)) {
        return [];
    }
    return node_fs_1.default
        .readdirSync(releasesDir)
        .filter((fileName) => fileName.endsWith('.md') && fileName !== 'README.md')
        .sort((left, right) => left.localeCompare(right))
        .map((fileName) => (0, render_1.parseReleaseSummary)(config, node_path_1.default.join(releasesDir, fileName)))
        .sort((left, right) => config.versionStrategy.compareDesc(left, right));
}
function updatePatchNotesIndex(config, version) {
    const { indexPath } = (0, config_1.resolvePaths)(config);
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(indexPath), { recursive: true });
    node_fs_1.default.writeFileSync(indexPath, (0, render_1.renderPatchNotesIndex)(config, listReleaseSummaries(config), version), 'utf8');
}
function publishRelease(config, options = {}) {
    const version = resolveVersion(config, options.version);
    const date = options.date || (0, fragments_1.todayIso)();
    config.versionStrategy.assert(version);
    const paths = (0, config_1.resolvePaths)(config);
    node_fs_1.default.mkdirSync(paths.releasesDir, { recursive: true });
    node_fs_1.default.mkdirSync(paths.archiveDir, { recursive: true });
    node_fs_1.default.mkdirSync(paths.unreleasedDir, { recursive: true });
    const fragments = (0, fragments_1.collectFragments)(config);
    if (fragments.length === 0 && !options.allowEmpty) {
        throw new Error('No unreleased patch-note fragments found. Use --allow-empty to publish an empty note.');
    }
    const releasePath = node_path_1.default.join(paths.releasesDir, config.versionStrategy.releaseFileName(version));
    if (node_fs_1.default.existsSync(releasePath) && !options.force) {
        throw new Error(`${node_path_1.default.relative(paths.rootDir, releasePath)} already exists. Re-run with --force to overwrite it.`);
    }
    node_fs_1.default.writeFileSync(releasePath, (0, render_1.renderReleaseNote)(config, { version, date, fragments, commit: String(options.commit || '') }), 'utf8');
    if (fragments.length > 0) {
        const archiveVersionDir = node_path_1.default.join(paths.archiveDir, version);
        node_fs_1.default.mkdirSync(archiveVersionDir, { recursive: true });
        for (const fragment of fragments) {
            node_fs_1.default.copyFileSync(fragment.filePath, node_path_1.default.join(archiveVersionDir, fragment.fileName));
            node_fs_1.default.rmSync(fragment.filePath);
        }
    }
    updatePatchNotesIndex(config, version);
    return { version, releasePath, fragmentCount: fragments.length };
}
function validateReleaseFile(config, errors, rootDir, releasePath, expectedVersion) {
    const release = tryStep(errors, () => (0, render_1.parseReleaseSummary)(config, releasePath), null);
    if (!release) {
        return;
    }
    const relativePath = node_path_1.default.relative(rootDir, releasePath);
    if (release.titleVersion !== expectedVersion) {
        errors.push(`${relativePath} title version ${release.titleVersion || '(missing)'} does not match ${expectedVersion}.`);
    }
    if (release.packageVersion !== expectedVersion) {
        errors.push(`${relativePath} package version ${release.packageVersion || '(missing)'} does not match ${expectedVersion}.`);
    }
    if (release.stage.toLowerCase() !== config.stage.toLowerCase()) {
        errors.push(`${relativePath} stage ${release.stage || '(missing)'} must be ${config.stage}.`);
    }
    if (!release.date) {
        errors.push(`${relativePath} is missing a release date.`);
    }
}
function validateReleaseState(config, explicitVersion = '') {
    const errors = [];
    const rootDir = node_path_1.default.resolve(config.rootDir);
    const version = tryStep(errors, () => resolveVersion(config, explicitVersion), '');
    if (version) {
        tryStep(errors, () => config.versionStrategy.assert(version), undefined);
        if (config.manifest.validateVersionSync) {
            const manifestErrors = tryStep(errors, () => config.manifest.validateVersionSync(rootDir, version), []);
            errors.push(...manifestErrors);
        }
    }
    tryStep(errors, () => (0, fragments_1.collectFragments)(config), []);
    const { releasesDir, indexPath } = (0, config_1.resolvePaths)(config);
    // Best-effort filename for path construction only; an invalid version was
    // already reported by assert() above, so this never emits a second error.
    let currentReleaseFileName = `${version}.md`;
    try {
        currentReleaseFileName = config.versionStrategy.releaseFileName(version);
    }
    catch {
        // reported above
    }
    const currentReleasePath = node_path_1.default.join(releasesDir, currentReleaseFileName);
    if (version && !node_fs_1.default.existsSync(currentReleasePath)) {
        errors.push(`Current version ${version} has no published patch note at ${node_path_1.default.relative(rootDir, currentReleasePath)}.`);
    }
    else if (version) {
        validateReleaseFile(config, errors, rootDir, currentReleasePath, version);
    }
    if (!node_fs_1.default.existsSync(indexPath)) {
        errors.push(`Missing patch-note index: ${node_path_1.default.relative(rootDir, indexPath)}.`);
    }
    else {
        const indexSource = node_fs_1.default.readFileSync(indexPath, 'utf8');
        if (version && !indexSource.includes(`${config.currentVersionLabel}: \`${version}\``)) {
            errors.push(`Patch-note index does not list ${config.currentVersionLabel.toLowerCase()} ${version}.`);
        }
        if (!indexSource.includes('<!-- patch-notes:start -->') || !indexSource.includes('<!-- patch-notes:end -->')) {
            errors.push('Patch-note index is missing generated release markers.');
        }
        const expectedLink = `[${version}](${(0, config_1.releaseLinkPath)(config, currentReleaseFileName)})`;
        if (version && !indexSource.includes(expectedLink)) {
            errors.push(`Patch-note index does not link to ${config.paths.notesDir}/releases/${currentReleaseFileName}.`);
        }
    }
    for (const release of listReleaseSummaries(config)) {
        tryStep(errors, () => config.versionStrategy.assert(release.version), undefined, `${config.paths.notesDir}/releases/${release.fileName}: `);
        if (!release.titleVersion) {
            errors.push(`${config.paths.notesDir}/releases/${release.fileName} is missing the standard patch-note title.`);
        }
        if (release.packageVersion && release.packageVersion !== release.version) {
            errors.push(`${config.paths.notesDir}/releases/${release.fileName} package version ${release.packageVersion} does not match title version ${release.version}.`);
        }
    }
    return { ok: errors.length === 0, errors, version };
}
function preflightCut(config, targetVersion, options) {
    config.versionStrategy.assert(targetVersion);
    const rootDir = node_path_1.default.resolve(config.rootDir);
    const { releasesDir } = (0, config_1.resolvePaths)(config);
    const fragments = (0, fragments_1.collectFragments)(config);
    if (fragments.length === 0 && !options.allowEmpty) {
        throw new Error('No unreleased patch-note fragments found. Add fragments or pass --allow-empty.');
    }
    const releasePath = node_path_1.default.join(releasesDir, config.versionStrategy.releaseFileName(targetVersion));
    if (node_fs_1.default.existsSync(releasePath) && !options.force) {
        throw new Error(`${node_path_1.default.relative(rootDir, releasePath)} already exists. Re-run with --force to overwrite it.`);
    }
    return { fragmentCount: fragments.length, releasePath };
}
/**
 * Bumps the manifest to the next (or explicit) version, publishes fragments
 * into a versioned release file, and validates the result — rouge's exact
 * current order (bump -> publish -> validate), matching `cut-release.js`.
 */
function cutRelease(config, options = {}) {
    const previousVersion = resolveVersion(config);
    const version = String(options.version || config.versionStrategy.next(previousVersion)).trim();
    const preflight = preflightCut(config, version, options);
    bumpVersion(config, { version });
    const release = publishRelease(config, {
        version,
        date: options.date,
        commit: options.commit,
        force: options.force,
        allowEmpty: options.allowEmpty,
    });
    const validation = validateReleaseState(config, version);
    if (!validation.ok) {
        throw new Error(`Release ${version} was cut but failed validation:\n${validation.errors.join('\n')}`);
    }
    return {
        previousVersion,
        version,
        fragmentCount: preflight.fragmentCount,
        releasePath: release.releasePath,
    };
}
