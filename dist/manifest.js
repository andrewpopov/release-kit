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
        if (lockFileExists && lock) {
            lock.version = version;
            lock.packages[''].version = version;
            writeJsonFile(lockFilePath, lock);
        }
    }
    /** See `VersionManifestAdapter.snapshot`'s doc comment. */
    function snapshot(rootDir) {
        return (0, fs_snapshot_1.combineRestores)([(0, fs_snapshot_1.snapshotFile)(packagePath(rootDir)), (0, fs_snapshot_1.snapshotFile)(lockPath(rootDir))]);
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
    return { readVersion, writeVersion, validateVersionSync, snapshot };
}
