"use strict";
/**
 * Version-manifest adapter seam. The host manifest is whatever file(s) a
 * consumer treats as the source of truth for its current version — for
 * rouge that's `package.json` (+ `package-lock.json`).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.npmPackage = npmPackage;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const fs_snapshot_1 = require("./fs-snapshot");
function readJsonFile(filePath) {
    return JSON.parse(node_fs_1.default.readFileSync(filePath, 'utf8'));
}
function writeJsonFile(filePath, value) {
    node_fs_1.default.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
/**
 * `npmPackage` adapter — reads/writes `package.json` (+ `package-lock.json`
 * when present) exactly as rouge's current tooling does, but in
 * OPTIONAL-lockfile mode: a missing lockfile is not an error.
 */
function npmPackage(options = {}) {
    const packageFileName = options.packageFileName ?? 'package.json';
    const lockFileName = options.lockFileName ?? 'package-lock.json';
    // Set by `snapshot()` (called BEFORE `writeVersion` by `cutRelease`) and
    // read by `writeVersion` so each write can commit its OWN guard the
    // instant it lands — see the comments inline below for why that matters.
    let activeGuards;
    function packagePath(rootDir) {
        return node_path_1.default.join(rootDir, packageFileName);
    }
    function lockPath(rootDir) {
        return node_path_1.default.join(rootDir, lockFileName);
    }
    function readVersion(rootDir) {
        const pkg = readJsonFile(packagePath(rootDir));
        return String(pkg.version || '').trim();
    }
    function writeVersion(rootDir, version) {
        const pkgPath = packagePath(rootDir);
        const pkg = readJsonFile(pkgPath);
        // Read AND shape-validate the lockfile BEFORE writing anything: a
        // malformed lockfile must fail before package.json is touched, not
        // after (PKG-140 finding 2) — otherwise a half-bumped manifest is left
        // behind for every consumer whose lockfile happens to be malformed.
        const lockFilePath = lockPath(rootDir);
        const lockFileExists = node_fs_1.default.existsSync(lockFilePath);
        let lock;
        if (lockFileExists) {
            lock = readJsonFile(lockFilePath);
            const packages = lock.packages;
            if (!packages || typeof packages !== 'object' || Array.isArray(packages) || !packages['']) {
                throw new Error(`${lockFileName} is missing packages[""].version.`);
            }
        }
        pkg.version = version;
        writeJsonFile(pkgPath, pkg);
        // Commit the moment this write lands, not after the whole function
        // returns: if the lock-file write below then throws, package.json's
        // guard must already know these are OUR bytes, so a later rollback
        // still restores it unconditionally (nothing has raced us for it yet)
        // instead of mistaking its own bumped content for a stranger's edit.
        activeGuards?.pkg.commit();
        if (lockFileExists && lock) {
            lock.version = version;
            lock.packages[''].version = version;
            writeJsonFile(lockFilePath, lock);
            activeGuards?.lock.commit();
        }
    }
    /**
     * See `VersionManifestAdapter.snapshot`'s doc comment. Stashes the two
     * per-file guards in `activeGuards` so `writeVersion` (called later, by
     * `cutRelease`, using this SAME adapter instance) can commit each one the
     * instant its own write lands — see the comments inside `writeVersion`.
     */
    function snapshot(rootDir) {
        const pkg = (0, fs_snapshot_1.snapshotFile)(packagePath(rootDir));
        const lock = (0, fs_snapshot_1.snapshotFile)(lockPath(rootDir));
        activeGuards = { pkg, lock };
        return {
            commit() {
                pkg.commit();
                lock.commit();
            },
            restore: (0, fs_snapshot_1.combineRestores)([pkg.restore, lock.restore]),
        };
    }
    function validateVersionSync(rootDir, version) {
        const errors = [];
        const lockFilePath = lockPath(rootDir);
        if (!node_fs_1.default.existsSync(lockFilePath)) {
            return errors;
        }
        let lock;
        try {
            lock = readJsonFile(lockFilePath);
        }
        catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
            return errors;
        }
        const lockVersion = String(lock.version || '').trim();
        const packages = lock.packages;
        const rootPackageVersion = String(packages?.['']?.version || '').trim();
        if (lockVersion !== version) {
            errors.push(`${lockFileName} version ${lockVersion || '(missing)'} does not match ${packageFileName} version ${version}.`);
        }
        if (rootPackageVersion !== version) {
            errors.push(`${lockFileName} packages[""].version ${rootPackageVersion || '(missing)'} does not match ${packageFileName} version ${version}.`);
        }
        return errors;
    }
    /**
     * Preserves, byte-for-byte, the product/repository derivation
     * `createReleaseArtifactV1` used to inline before PKG-140 finding 4: the
     * package's `name` (falling back to the root directory's basename) and its
     * `repository` field (a bare string, or `{ url }`, falling back to
     * `rootDir`). Moving it here — rather than changing what it returns — is
     * what keeps `npmPackage()` behaving exactly as it did for existing
     * consumers.
     */
    function readArtifactMetadata(rootDir) {
        const pkg = readJsonFile(packagePath(rootDir));
        const repository = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url ?? rootDir;
        return { product: pkg.name ?? node_path_1.default.basename(rootDir), repository };
    }
    return { readVersion, writeVersion, validateVersionSync, snapshot, readArtifactMetadata };
}
