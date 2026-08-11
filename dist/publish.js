"use strict";
/**
 * Publish/validate flow — ported byte-for-byte from rouge's
 * `scripts/lib/release-notes-core.js`. Happy-path write order (release file
 * -> archive copies -> delete unreleased -> refresh index) matches rouge's
 * original scripts exactly. `cutRelease` (bump -> publish -> validate) is
 * transactional: it snapshots every file a cut can touch before the first
 * write and rolls all of them back — manifest, notes-target output, and
 * archived fragments restored to their original locations — if bump,
 * publish, archive, or the final validation fails (PKG-140 finding 2).
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
const version_1 = require("./version");
const fs_snapshot_1 = require("./fs-snapshot");
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
/**
 * Refuses an implicit (non-explicit-version) major/minor cut when the
 * configured strategy hasn't declared whether it honours fragment kinds.
 * Shared by `nextVersion`, `bumpVersion`, and `cutRelease` so the CLI `bump`
 * command can't write a wrong manifest version that a later `publish`
 * inherits.
 */
function assertBumpLevelSupported(config, level, fragments) {
    if (level === 'patch') {
        return;
    }
    // Allow-list the two declarations rather than testing `!== undefined`: a
    // config loaded at runtime is not type-checked, so `false`, `null`, or a
    // typo like 'support' would otherwise read as "declared" and wave a legacy
    // patch-only strategy straight through — reintroducing the mislabeling.
    const support = config.versionStrategy.bumpLevelSupport;
    if (support === 'supported' || support === 'ignored') {
        return;
    }
    const offenders = fragments
        .filter((fragment) => (0, version_1.resolveBumpLevel)([fragment.kind], config.kinds) === level)
        .map((fragment) => `${fragment.kind}/${fragment.fileName}`)
        .join(', ');
    const declaration = support === undefined
        ? 'does not declare bumpLevelSupport'
        : `declares an invalid bumpLevelSupport ${JSON.stringify(support)}`;
    throw new Error(`Refusing to auto-version a ${level} release: the configured version strategy ${declaration}, ` +
        `so release-kit cannot tell whether it honours fragment kinds. ` +
        `Fragment(s) requiring a ${level} bump: ${offenders}. ` +
        `Upgrade the strategy (add bumpLevelSupport: 'supported' | 'ignored') or pass an explicit version.`);
}
/** Resolves the bump level from `fragments`, applying the refusal guard above. */
function resolveGuardedBumpLevel(config, fragments) {
    const level = (0, version_1.resolveBumpLevel)(fragments.map((fragment) => fragment.kind), config.kinds);
    assertBumpLevelSupported(config, level, fragments);
    return level;
}
/** Returns `explicitVersion` trimmed, or the strategy's next version after the manifest's current version. */
function nextVersion(config, explicitVersion) {
    const previousVersion = resolveVersion(config);
    if (explicitVersion) {
        return String(explicitVersion).trim();
    }
    const fragments = (0, fragments_1.collectFragments)(config);
    const level = resolveGuardedBumpLevel(config, fragments);
    return String(config.versionStrategy.next(previousVersion, { bump: level })).trim();
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
    let version;
    if (options.version) {
        version = String(options.version).trim();
    }
    else {
        const fragments = (0, fragments_1.collectFragments)(config);
        const level = resolveGuardedBumpLevel(config, fragments);
        version = String(config.versionStrategy.next(previousVersion, { bump: level })).trim();
    }
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
/**
 * Shared implementation behind `publishRelease`. `fragmentsOverride`, when
 * passed, is used verbatim instead of re-collecting — so `cutRelease` can
 * thread through the exact fragment set that already chose its version.
 */
function publishReleaseWithFragments(config, options, fragmentsOverride) {
    const version = resolveVersion(config, options.version);
    const date = options.date || (0, fragments_1.todayIso)();
    config.versionStrategy.assert(version);
    const paths = (0, config_1.resolvePaths)(config);
    node_fs_1.default.mkdirSync(paths.archiveDir, { recursive: true });
    node_fs_1.default.mkdirSync(paths.unreleasedDir, { recursive: true });
    const fragments = fragmentsOverride ?? (0, fragments_1.collectFragments)(config);
    if (fragments.length === 0 && !options.allowEmpty) {
        throw new Error('No unreleased patch-note fragments found. Use --allow-empty to publish an empty note.');
    }
    const { releasePath } = resolveNotesTarget(config).publish(config, { version, date, commit: String(options.commit || ''), fragments }, { force: options.force });
    return { version, releasePath, fragmentCount: fragments.length };
}
function publishRelease(config, options = {}) {
    return publishReleaseWithFragments(config, options);
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
function preflightCut(config, targetVersion, options, fragments) {
    config.versionStrategy.assert(targetVersion);
    if (resolveNotesTarget(config).hasVersion(config, targetVersion) && !options.force) {
        throw new Error(`Release notes for ${targetVersion} already exist. Re-run with force to overwrite.`);
    }
    if (fragments.length === 0 && !options.allowEmpty) {
        throw new Error('No unreleased patch-note fragments found. Add fragments or pass --allow-empty.');
    }
    return { fragmentCount: fragments.length };
}
/**
 * Bumps the manifest to the next (or explicit) version, publishes fragments
 * into a versioned release file, and validates the result — rouge's exact
 * write order (bump -> publish -> validate), matching `cut-release.js`.
 * Fragments are collected once here and threaded through preflight/publish,
 * so the set that chose the version is provably the set that gets published.
 *
 * TRANSACTIONAL (PKG-140 finding 2): `preflightCut` validates everything it
 * can before any write. Everything a cut can still touch after that —
 * the manifest (via `config.manifest.snapshot`) and the notes target's
 * output plus the fragments it archives (via `notesTarget.snapshot`) — is
 * snapshotted BEFORE the bump, so a failure in bump, publish, archive, or
 * the final validation restores every one of those files to its exact
 * pre-cut bytes, including moving archived fragments back to `unreleased/`.
 * A rollback failure is appended to (never replaces) the error that
 * triggered it — see `rollbackOnFailure`.
 */
function cutRelease(config, options = {}) {
    const previousVersion = resolveVersion(config);
    const fragments = (0, fragments_1.collectFragments)(config);
    let version;
    if (options.version) {
        version = String(options.version).trim();
    }
    else {
        const level = resolveGuardedBumpLevel(config, fragments);
        version = String(config.versionStrategy.next(previousVersion, { bump: level })).trim();
    }
    const preflight = preflightCut(config, version, options, fragments);
    const rootDir = node_path_1.default.resolve(config.rootDir);
    const notesTarget = resolveNotesTarget(config);
    const date = options.date || (0, fragments_1.todayIso)();
    const commit = String(options.commit || '');
    const ctx = { version, date, commit, fragments };
    const restore = (0, fs_snapshot_1.combineRestores)([
        config.manifest.snapshot?.(rootDir) ?? (() => { }),
        notesTarget.snapshot?.(config, ctx) ?? (() => { }),
    ]);
    try {
        bumpVersion(config, { version });
        const release = publishReleaseWithFragments(config, { version, date, commit, force: options.force, allowEmpty: options.allowEmpty }, fragments);
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
    catch (error) {
        return (0, fs_snapshot_1.rollbackOnFailure)(restore, error);
    }
}
