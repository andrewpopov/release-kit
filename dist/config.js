"use strict";
/**
 * The `ReleaseKitConfig` seam. Every rouge-coupled detail the extraction
 * survey flagged (product name, paths, kinds, hygiene classification lists,
 * title/intro wording, version-strategy, manifest adapter) lives here; the
 * mechanics in the other modules are generic.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.defineConfig = defineConfig;
exports.resolvePaths = resolvePaths;
exports.notesDirPosix = notesDirPosix;
exports.releaseLinkPath = releaseLinkPath;
exports.renderTitle = renderTitle;
exports.titleRegExp = titleRegExp;
exports.applyTemplate = applyTemplate;
const node_path_1 = __importDefault(require("node:path"));
/** Identity helper for type inference/IDE support when authoring a config file. */
function defineConfig(config) {
    return config;
}
/** Resolves a config's logical paths against its (possibly relative) `rootDir`. */
function resolvePaths(config) {
    const rootDir = node_path_1.default.resolve(config.rootDir);
    const notesDir = node_path_1.default.join(rootDir, config.paths.notesDir);
    return {
        rootDir,
        notesDir,
        unreleasedDir: node_path_1.default.join(notesDir, 'unreleased'),
        releasesDir: node_path_1.default.join(notesDir, 'releases'),
        archiveDir: node_path_1.default.join(notesDir, 'archive'),
        indexPath: node_path_1.default.join(rootDir, config.paths.indexPath),
    };
}
/** POSIX-style join of the configured `notesDir` with extra path segments. */
function notesDirPosix(config, ...segments) {
    return [config.paths.notesDir, ...segments].join('/');
}
/**
 * Relative link (POSIX-style) from the patch-notes index file's directory to
 * a release file, e.g. `patch-notes/releases/0.1.0-alpha.3.md` when the
 * index lives at `docs/PATCH_NOTES.md` and the release lives under
 * `docs/patch-notes/releases/`.
 */
function releaseLinkPath(config, releaseFileName) {
    const indexDir = node_path_1.default.posix.dirname(config.paths.indexPath);
    const releaseTarget = notesDirPosix(config, 'releases', releaseFileName);
    return node_path_1.default.posix.relative(indexDir, releaseTarget);
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/** Fills `{productName}`/`{version}` placeholders in `titleTemplate`. */
function renderTitle(config, version) {
    return config.titleTemplate.replace('{productName}', config.productName).replace('{version}', version);
}
/**
 * Builds a START-anchored (`^`, multiline) regex from `titleTemplate` with
 * `{version}` as a `[^\s]+` capture group — the single source shared by the
 * renderer and the parser so they can never drift apart. Intentionally NOT
 * end-anchored: this matches the upstream (rouge) title regex, which accepts
 * trailing text after the suffix, so already-published notes keep parsing.
 */
function titleRegExp(config) {
    const withProduct = config.titleTemplate.replace('{productName}', config.productName);
    const parts = withProduct.split('{version}');
    if (parts.length !== 2) {
        throw new Error('titleTemplate must contain exactly one {version} placeholder.');
    }
    return new RegExp(`^${escapeRegExp(parts[0])}([^\\s]+)${escapeRegExp(parts[1])}`, 'm');
}
/** Minimal `{key}` substitution used for the intro-text templates. */
function applyTemplate(template, vars) {
    return Object.entries(vars).reduce((acc, [key, value]) => acc.split(`{${key}}`).join(value), template);
}
