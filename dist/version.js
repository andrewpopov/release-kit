"use strict";
/**
 * Version-strategy seam. `VersionStrategy` is the pluggable policy for how a
 * product's version string is shaped, validated, ordered, and mapped to a
 * release-file name. `alphaSemver` reproduces rouge's exact current behavior
 * (`X.Y.Z-alpha.N`, bump only `N`).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALPHA_VERSION_RE = void 0;
exports.alphaSemver = alphaSemver;
/** `X.Y.Z-alpha.N` — matches rouge's `ALPHA_VERSION_RE` exactly. */
exports.ALPHA_VERSION_RE = /^(\d+)\.(\d+)\.(\d+)-alpha\.(\d+)$/;
/**
 * Alpha-semver version strategy: `0.1.0-alpha.0`, `0.1.0-alpha.1`, ...
 * `next()` only ever bumps the trailing alpha counter.
 */
function alphaSemver(options = {}) {
    const versionLabel = options.versionLabel ?? 'Version';
    function assert(version) {
        if (!exports.ALPHA_VERSION_RE.test(String(version || ''))) {
            throw new Error(`${versionLabel} "${version}" must use alpha semver, for example 0.1.0-alpha.0.`);
        }
    }
    function next(version) {
        const match = String(version || '').match(exports.ALPHA_VERSION_RE);
        if (!match) {
            assert(version);
        }
        const parts = match;
        return `${parts[1]}.${parts[2]}.${parts[3]}-alpha.${Number(parts[4]) + 1}`;
    }
    function releaseFileName(version) {
        assert(version);
        return `${version}.md`;
    }
    function compareDesc(a, b) {
        const leftMatch = String(a.version || '').match(exports.ALPHA_VERSION_RE);
        const rightMatch = String(b.version || '').match(exports.ALPHA_VERSION_RE);
        if (leftMatch && rightMatch) {
            for (let index = 1; index <= 4; index += 1) {
                const delta = Number(rightMatch[index]) - Number(leftMatch[index]);
                if (delta !== 0) {
                    return delta;
                }
            }
        }
        return a.date !== b.date
            ? String(b.date || '').localeCompare(String(a.date || ''))
            : String(b.version || '').localeCompare(String(a.version || ''));
    }
    return { assert, next, compareDesc, releaseFileName };
}
