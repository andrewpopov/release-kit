"use strict";
/**
 * Version-strategy seam. `VersionStrategy` is the pluggable policy for how a
 * product's version string is shaped, validated, ordered, and mapped to a
 * release-file name. `alphaSemver` reproduces rouge's exact current behavior
 * (`X.Y.Z-alpha.N`, bump only `N`); `stableSemver` provides conventional
 * stable releases (`X.Y.Z`, defaulting to a patch bump).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.STABLE_VERSION_RE = exports.ALPHA_VERSION_RE = exports.DEFAULT_KIND_BUMP = void 0;
exports.resolveBumpLevel = resolveBumpLevel;
exports.alphaSemver = alphaSemver;
exports.stableSemver = stableSemver;
/** Conventional weight for the well-known kind ids. Any other id defaults to 'patch'
 *  and must declare `bump` on its ReleaseKindDef to weigh more. */
exports.DEFAULT_KIND_BUMP = Object.freeze({
    breaking: 'major',
    added: 'minor',
});
const BUMP_RANK = Object.freeze({ major: 2, minor: 1, patch: 0 });
/**
 * Own-property lookup, NOT `bump in BUMP_RANK` — a runtime-loaded CJS config
 * is not type-checked, and `in` would accept inherited `Object.prototype` keys
 * (`"toString"`, `"constructor"`, ...), which then rank as `undefined` and
 * silently degrade to a patch bump. That is the exact class of silent
 * mislabeling this whole change exists to remove.
 */
function isBumpLevel(value) {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(BUMP_RANK, value);
}
/** Highest bump level across `kinds` for the given fragment kind ids. Empty → 'patch'. */
function resolveBumpLevel(fragmentKindIds, kinds) {
    let highest = 'patch';
    for (const kindId of fragmentKindIds) {
        const def = kinds.find((kind) => kind.id === kindId);
        const bump = def?.bump ?? exports.DEFAULT_KIND_BUMP[kindId] ?? 'patch';
        if (!isBumpLevel(bump)) {
            throw new Error(`Kind "${kindId}" declares an unknown bump level "${String(bump)}". Expected one of: major, minor, patch.`);
        }
        if (BUMP_RANK[bump] > BUMP_RANK[highest]) {
            highest = bump;
        }
    }
    return highest;
}
/** `X.Y.Z-alpha.N` — matches rouge's `ALPHA_VERSION_RE` exactly. */
exports.ALPHA_VERSION_RE = /^(\d+)\.(\d+)\.(\d+)-alpha\.(\d+)$/;
/** `X.Y.Z` with numeric major, minor, and patch components. */
exports.STABLE_VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;
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
    // Deliberate product policy: an alpha line bumps only its trailing counter,
    // so a `breaking` fragment does not move the core version. Hence
    // `bumpLevelSupport: 'ignored'` below — the context is accepted, not read.
    function next(version, _context) {
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
    return { assert, next, compareDesc, releaseFileName, bumpLevelSupport: 'ignored' };
}
/**
 * Stable-semver version strategy: `1.0.0`, `1.0.1`, ...
 * `next()` derives the bump from `context.bump` (default `'patch'`):
 *  - `major` bumps the major component, EXCEPT pre-1.0 (`0.x.y`), where a
 *    breaking change bumps minor instead — 0.x already declares an unstable
 *    API, so there is no major to bump into.
 *  - `minor` bumps the minor component and resets patch.
 *  - `patch` (or an absent context) increments the patch component, matching
 *    the previous unconditional behavior.
 * Callers can still supply an explicit version to the release-kit bump/cut
 * APIs to bypass this derivation entirely.
 */
function stableSemver(options = {}) {
    const versionLabel = options.versionLabel ?? 'Version';
    function parse(version) {
        const match = String(version || '').match(exports.STABLE_VERSION_RE);
        if (!match) {
            throw new Error(`${versionLabel} "${version}" must use stable semver, for example 1.0.0.`);
        }
        return match;
    }
    function assert(version) {
        parse(version);
    }
    function next(version, context) {
        const match = parse(version);
        const major = Number(match[1]);
        const minor = Number(match[2]);
        const patch = Number(match[3]);
        const bump = context?.bump ?? 'patch';
        if (bump === 'major') {
            return major === 0 ? `0.${minor + 1}.0` : `${major + 1}.0.0`;
        }
        if (bump === 'minor') {
            return `${major}.${minor + 1}.0`;
        }
        return `${major}.${minor}.${patch + 1}`;
    }
    function releaseFileName(version) {
        assert(version);
        return `${version}.md`;
    }
    function compareDesc(a, b) {
        const leftMatch = String(a.version || '').match(exports.STABLE_VERSION_RE);
        const rightMatch = String(b.version || '').match(exports.STABLE_VERSION_RE);
        if (leftMatch && rightMatch) {
            for (let index = 1; index <= 3; index += 1) {
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
    return { assert, next, compareDesc, releaseFileName, bumpLevelSupport: 'supported' };
}
