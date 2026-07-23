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
exports.tryStep = tryStep;
exports.resolveNotesTarget = resolveNotesTarget;
exports.resolveVersion = resolveVersion;
exports.nextVersion = nextVersion;
exports.getGitShortSha = getGitShortSha;
exports.bumpVersion = bumpVersion;
exports.listReleaseSummaries = listReleaseSummaries;
exports.updatePatchNotesIndex = updatePatchNotesIndex;
exports.createReleaseArtifactV1 = createReleaseArtifactV1;
exports.publishRelease = publishRelease;
exports.validateReleaseState = validateReleaseState;
exports.cutRelease = cutRelease;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
const node_crypto_1 = require("node:crypto");
const config_1 = require("./config");
const fragments_1 = require("./fragments");
const render_1 = require("./render");
const notes_target_1 = require("./notes-target");
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
/** Resolves the config's notes target, defaulting to `patchNotesDirTarget()` (rouge's current behavior). */
function resolveNotesTarget(config) {
    return config.notesTarget ?? (0, notes_target_1.patchNotesDirTarget)();
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
    config.versionStrategy.assert(version);
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
/** Build a deterministic, transport-neutral descriptor only after validation succeeds. */
function createReleaseArtifactV1(config, result, commit = '') {
    const validation = validateReleaseState(config, result.version);
    if (!validation.ok)
        throw new Error(`Release ${result.version} is not validated: ${validation.errors.join('; ')}`);
    const rootDir = node_path_1.default.resolve(config.rootDir);
    const renderedNotes = node_fs_1.default.readFileSync(result.releasePath, 'utf8');
    const manifest = JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(rootDir, 'package.json'), 'utf8'));
    const repository = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url ?? rootDir;
    return Object.freeze({ schemaVersion: 1, product: manifest.name ?? node_path_1.default.basename(rootDir), repository, version: result.version,
        commit: commit || getGitShortSha(rootDir), date: (0, render_1.parseReleaseSummary)(config, result.releasePath).date, renderedNotes,
        notesDigest: (0, node_crypto_1.createHash)('sha256').update(renderedNotes).digest('hex'), artifactRef: node_path_1.default.relative(rootDir, result.releasePath), fragmentCount: result.fragmentCount });
}
function publishRelease(config, options = {}) {
    const version = resolveVersion(config, options.version);
    const date = options.date || (0, fragments_1.todayIso)();
    config.versionStrategy.assert(version);
    const paths = (0, config_1.resolvePaths)(config);
    node_fs_1.default.mkdirSync(paths.archiveDir, { recursive: true });
    node_fs_1.default.mkdirSync(paths.unreleasedDir, { recursive: true });
    const fragments = (0, fragments_1.collectFragments)(config);
    if (fragments.length === 0 && !options.allowEmpty) {
        throw new Error('No unreleased patch-note fragments found. Use --allow-empty to publish an empty note.');
    }
    const { releasePath } = resolveNotesTarget(config).publish(config, { version, date, commit: String(options.commit || ''), fragments }, { force: options.force });
    return { version, releasePath, fragmentCount: fragments.length };
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
    errors.push(...resolveNotesTarget(config).validate(config, version));
    return { ok: errors.length === 0, errors, version };
}
/**
 * Asserts the version shape, the empty-fragments guard, and the "notes
 * already exist" guard BEFORE the manifest is bumped — so re-cutting an
 * existing version without `--force` fails clean, leaving package.json
 * untouched, instead of bumping first and only then throwing inside
 * `publishRelease`/`ReleaseNotesTarget.publish`. That target-specific publish
 * check is kept too (defense in depth against direct `publishRelease` calls
 * that bypass `cutRelease`).
 */
function preflightCut(config, targetVersion, options) {
    config.versionStrategy.assert(targetVersion);
    if (resolveNotesTarget(config).hasVersion(config, targetVersion) && !options.force) {
        throw new Error(`Release notes for ${targetVersion} already exist. Re-run with force to overwrite.`);
    }
    const fragments = (0, fragments_1.collectFragments)(config);
    if (fragments.length === 0 && !options.allowEmpty) {
        throw new Error('No unreleased patch-note fragments found. Add fragments or pass --allow-empty.');
    }
    return { fragmentCount: fragments.length };
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
