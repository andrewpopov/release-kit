"use strict";
/**
 * Announce-once ledger: tracks which release versions have already been
 * posted to Discord so `announceReleaseToDiscord` can skip a re-announce
 * when a deploy-kit `deliveryEvent` hook fires more than once for the same
 * release (every deploy, not every release).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveAnnouncementStatePath = resolveAnnouncementStatePath;
exports.readAnnouncedVersions = readAnnouncedVersions;
exports.hasAnnouncedVersion = hasAnnouncedVersion;
exports.recordAnnouncedVersion = recordAnnouncedVersion;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
/**
 * Resolves where the announce-once ledger lives. First hit wins, in order:
 * an explicit `options.stateFile`, `RELEASE_ANNOUNCE_STATE`,
 * `config.paths.announcementStateFile`, deploy-kit's shared dir
 * (`DEPLOY_KIT_SHARED_DIR` + `/release-announcements.json`), a sibling
 * `../shared/release-announcements.json` directory (deploy-kit's releases
 * layout convention, only if that directory actually exists), and finally a
 * fallback file inside `rootDir` itself.
 */
function resolveAnnouncementStatePath(config, options = {}) {
    if (options.stateFile) {
        return { path: options.stateFile, durable: true, source: 'option' };
    }
    const envStateFile = process.env.RELEASE_ANNOUNCE_STATE;
    if (envStateFile) {
        return { path: envStateFile, durable: true, source: 'env' };
    }
    const configuredPath = config.paths.announcementStateFile;
    if (configuredPath) {
        return {
            path: node_path_1.default.join(node_path_1.default.resolve(config.rootDir), configuredPath),
            durable: true,
            source: 'config',
        };
    }
    const sharedDir = process.env.DEPLOY_KIT_SHARED_DIR;
    if (sharedDir) {
        return {
            path: node_path_1.default.join(sharedDir, 'release-announcements.json'),
            durable: true,
            source: 'deploy-kit-shared',
        };
    }
    const rootDir = node_path_1.default.resolve(config.rootDir);
    // Probe one-level-up first (`<rootDir>/../shared`), then two-levels-up
    // (`<rootDir>/../../shared`). deploy-kit's real releases layout is
    // `<app>/releases/<stamp>` with `shared/` a sibling of `releases/`, i.e.
    // two levels up from a release's rootDir — and rootDir is the physical
    // (symlink-resolved) path, so a one-level-up probe alone misses it. Some
    // flatter deploy layouts may still put `shared/` one level up, so that
    // case is checked first and wins if it exists.
    const siblingSharedCandidates = [
        node_path_1.default.join(rootDir, '..', 'shared'),
        node_path_1.default.join(rootDir, '..', '..', 'shared'),
    ];
    for (const siblingSharedDir of siblingSharedCandidates) {
        if (node_fs_1.default.existsSync(siblingSharedDir)) {
            return {
                path: node_path_1.default.join(siblingSharedDir, 'release-announcements.json'),
                durable: true,
                source: 'sibling-shared',
            };
        }
    }
    return {
        path: node_path_1.default.join(rootDir, '.release-announcements.json'),
        durable: false,
        source: 'fallback',
    };
}
function isAnnouncedVersionEntry(value) {
    return (typeof value === 'object' &&
        value !== null &&
        typeof value.version === 'string');
}
/**
 * Reads the announce-once ledger. Never throws: a missing file, an empty
 * file, unparseable JSON, or JSON with junk in place of `announced` all
 * degrade to `{ announced: [] }`.
 */
function readAnnouncedVersions(statePath) {
    let raw;
    try {
        raw = node_fs_1.default.readFileSync(statePath, 'utf8');
    }
    catch {
        return { announced: [] };
    }
    if (!raw.trim()) {
        return { announced: [] };
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return { announced: [] };
    }
    const announcedRaw = typeof parsed === 'object' && parsed !== null
        ? parsed.announced
        : undefined;
    if (!Array.isArray(announcedRaw)) {
        return { announced: [] };
    }
    return { announced: announcedRaw.filter(isAnnouncedVersionEntry) };
}
/**
 * Whether `entry` matches a query for `version`/`product`: the version must
 * match exactly, and either the products match or the entry predates
 * namespacing (no `product` field), which is treated as matching any
 * product so legacy ledger entries keep suppressing re-announces.
 */
function matchesVersion(entry, version, product) {
    if (entry.version !== version) {
        return false;
    }
    return entry.product === undefined || entry.product === product;
}
/**
 * Whether `version` is already recorded in the ledger at `statePath` for
 * `product`. A ledger entry with no `product` (written before namespacing
 * existed) matches any product.
 */
function hasAnnouncedVersion(statePath, version, product) {
    return readAnnouncedVersions(statePath).announced.some((entry) => matchesVersion(entry, version, product));
}
/**
 * Records `version` (namespaced by `product`, when given) as announced,
 * replacing any existing matching entry so the ledger doesn't grow
 * duplicates on a forced re-announce. Best-effort bookkeeping: creates
 * parent directories as needed, writes atomically (temp file + rename) so a
 * concurrent reader never sees a partially-written file, and never
 * throws — a write failure is logged via `console.warn` and swallowed
 * rather than failing the caller.
 */
function recordAnnouncedVersion(statePath, version, product) {
    try {
        const existing = readAnnouncedVersions(statePath);
        const remaining = existing.announced.filter((entry) => !matchesVersion(entry, version, product));
        const entry = { version, at: new Date().toISOString() };
        if (product !== undefined) {
            entry.product = product;
        }
        const next = { announced: [...remaining, entry] };
        node_fs_1.default.mkdirSync(node_path_1.default.dirname(statePath), { recursive: true });
        const tmpPath = node_path_1.default.join(node_path_1.default.dirname(statePath), `.${node_path_1.default.basename(statePath)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        node_fs_1.default.writeFileSync(tmpPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
        node_fs_1.default.renameSync(tmpPath, statePath);
    }
    catch (error) {
        console.warn(`release-kit: failed to record announced version ${version} at ${statePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
}
