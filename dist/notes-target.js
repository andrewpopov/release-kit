"use strict";
/**
 * Notes-target seam: pluggable policy for WHERE a version's release notes
 * get written and HOW their published state is validated. `patchNotesDirTarget`
 * is the DEFAULT and reproduces rouge's current per-version-file + index
 * behavior byte-for-byte (extracted, not rewritten, from `publish.ts`).
 * `changelogTarget` is the new flat-`CHANGELOG.md` target for consumers whose
 * CI greps `^## <version>`.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.patchNotesDirTarget = patchNotesDirTarget;
exports.changelogTarget = changelogTarget;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const config_1 = require("./config");
const render_1 = require("./render");
const publish_1 = require("./publish");
/** Archives consumed fragments to `archiveDir/<version>/` and deletes them from `unreleased/`. Shared by both targets. */
function archiveConsumedFragments(config, version, fragments) {
    if (fragments.length === 0) {
        return;
    }
    const paths = (0, config_1.resolvePaths)(config);
    const archiveVersionDir = node_path_1.default.join(paths.archiveDir, version);
    node_fs_1.default.mkdirSync(archiveVersionDir, { recursive: true });
    for (const fragment of fragments) {
        node_fs_1.default.copyFileSync(fragment.filePath, node_path_1.default.join(archiveVersionDir, fragment.fileName));
        node_fs_1.default.rmSync(fragment.filePath);
    }
}
function validateReleaseFile(config, errors, rootDir, releasePath, expectedVersion) {
    const release = (0, publish_1.tryStep)(errors, () => (0, render_1.parseReleaseSummary)(config, releasePath), null);
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
/**
 * DEFAULT target: rouge's current behavior — a `releases/<version>.md` file
 * per version plus a generated `PATCH_NOTES.md` index. Byte-identical to the
 * pre-seam `publishRelease`/`validateReleaseState` bodies; see
 * `golden.test.ts` / `rouge-real-files.test.ts`.
 */
function patchNotesDirTarget() {
    return {
        publish(config, ctx, options) {
            const paths = (0, config_1.resolvePaths)(config);
            node_fs_1.default.mkdirSync(paths.releasesDir, { recursive: true });
            const releasePath = node_path_1.default.join(paths.releasesDir, config.versionStrategy.releaseFileName(ctx.version));
            if (node_fs_1.default.existsSync(releasePath) && !options.force) {
                throw new Error(`${node_path_1.default.relative(paths.rootDir, releasePath)} already exists. Re-run with --force to overwrite it.`);
            }
            node_fs_1.default.writeFileSync(releasePath, (0, render_1.renderReleaseNote)(config, { version: ctx.version, date: ctx.date, fragments: ctx.fragments, commit: ctx.commit }), 'utf8');
            archiveConsumedFragments(config, ctx.version, ctx.fragments);
            (0, publish_1.updatePatchNotesIndex)(config, ctx.version);
            return { releasePath };
        },
        hasVersion(config, version) {
            const { releasesDir } = (0, config_1.resolvePaths)(config);
            return node_fs_1.default.existsSync(node_path_1.default.join(releasesDir, config.versionStrategy.releaseFileName(version)));
        },
        validate(config, version) {
            const errors = [];
            const rootDir = node_path_1.default.resolve(config.rootDir);
            const { releasesDir, indexPath } = (0, config_1.resolvePaths)(config);
            // Best-effort filename for path construction only; an invalid version is
            // reported by the generic version-strategy assert in validateReleaseState,
            // so this never emits a second error.
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
            for (const release of (0, publish_1.listReleaseSummaries)(config)) {
                (0, publish_1.tryStep)(errors, () => config.versionStrategy.assert(release.version), undefined, `${config.paths.notesDir}/releases/${release.fileName}: `);
                if (!release.titleVersion) {
                    errors.push(`${config.paths.notesDir}/releases/${release.fileName} is missing the standard patch-note title.`);
                }
                if (release.packageVersion && release.packageVersion !== release.version) {
                    errors.push(`${config.paths.notesDir}/releases/${release.fileName} package version ${release.packageVersion} does not match title version ${release.version}.`);
                }
            }
            return errors;
        },
    };
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/** Stable sort by `config.kinds` order; fragments whose kind isn't in `config.kinds` sort last. */
function sortFragmentsByKindOrder(config, fragments) {
    const orderOf = (kind) => {
        const index = config.kinds.findIndex((kindDef) => kindDef.id === kind);
        return index === -1 ? config.kinds.length : index;
    };
    return fragments
        .map((fragment, index) => ({ fragment, index, order: orderOf(fragment.kind) }))
        .sort((a, b) => (a.order === b.order ? a.index - b.index : a.order - b.order))
        .map((entry) => entry.fragment);
}
/** `- <summary>` plus the raw fragment body (if non-empty) as an indented continuation. */
function renderFlatBullets(fragments) {
    const lines = [];
    for (const fragment of fragments) {
        lines.push(`- ${fragment.summary}`);
        const body = fragment.body.trim();
        if (body) {
            for (const bodyLine of body.split('\n')) {
                lines.push(`  ${bodyLine}`);
            }
        }
    }
    return lines;
}
function renderChangelogSection(config, ctx, groupByKind) {
    const ordered = sortFragmentsByKindOrder(config, ctx.fragments);
    const lines = [`## ${ctx.version}`, ''];
    if (ordered.length === 0) {
        lines.push('_No changes recorded for this release._');
    }
    else if (!groupByKind) {
        lines.push(...renderFlatBullets(ordered));
    }
    else {
        for (const kindDef of config.kinds) {
            const group = ordered.filter((fragment) => fragment.kind === kindDef.id);
            if (group.length === 0) {
                continue;
            }
            lines.push(`### ${kindDef.heading}`, '', ...renderFlatBullets(group), '');
        }
    }
    return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n\n`;
}
/** Matches a full semver heading line (`## X.Y.Z`, optional `-prerelease` and `+build`), not a mere digit-led `## ` heading. */
const SEMVER_HEADING_RE = /^## \d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?\s*$/m;
/** Bounded exact-version heading matcher, e.g. `^## 1.2.3 *$`, shared by the force-check, `hasVersion`, and `validate`. */
function versionHeadingRegex(version) {
    return new RegExp(`^## ${escapeRegExp(version)} *$`, 'm');
}
/** Index (into `text`) of the line just after the section starting at `headingIndex` — i.e. the next `^## ` heading, or `text.length`. */
function sectionEnd(text, headingIndex) {
    const rest = text.slice(headingIndex);
    const firstLineBreak = rest.indexOf('\n');
    const searchFrom = firstLineBreak === -1 ? rest.length : firstLineBreak + 1;
    const nextHeadingMatch = /^## /m.exec(rest.slice(searchFrom));
    return nextHeadingMatch ? headingIndex + searchFrom + nextHeadingMatch.index : text.length;
}
/**
 * NEW target: a single flat `CHANGELOG.md` with `## X.Y.Z` version sections —
 * the invariant a fleet `release-guard` checks with `^## <version>`.
 */
function changelogTarget(options = {}) {
    const changelogRelPath = options.changelogPath ?? 'CHANGELOG.md';
    const title = options.title ?? 'Changelog';
    const groupByKind = options.groupByKind ?? false;
    return {
        publish(config, ctx, publishOptions) {
            const rootDir = node_path_1.default.resolve(config.rootDir);
            const changelogPath = node_path_1.default.join(rootDir, changelogRelPath);
            const existing = node_fs_1.default.existsSync(changelogPath) ? node_fs_1.default.readFileSync(changelogPath, 'utf8') : `# ${title}\n`;
            const section = renderChangelogSection(config, ctx, groupByKind);
            const existingMatch = versionHeadingRegex(ctx.version).exec(existing);
            // Only the two seams (end of `head`, and the file's final trailing
            // newline) are normalized below; `head` and `tail` themselves are
            // spliced in verbatim so unrelated sections keep their exact bytes.
            let nextContent;
            if (existingMatch) {
                if (!publishOptions.force) {
                    throw new Error(`CHANGELOG already has a ## ${ctx.version} section; re-run with force to overwrite.`);
                }
                const start = existingMatch.index;
                const end = sectionEnd(existing, start);
                const head = existing.slice(0, start).replace(/\n+$/, '');
                const tail = existing.slice(end);
                nextContent = head.length > 0 ? `${head}\n\n${section}${tail}` : `${section}${tail}`;
            }
            else {
                const semverHeadingMatch = SEMVER_HEADING_RE.exec(existing);
                if (semverHeadingMatch) {
                    const head = existing.slice(0, semverHeadingMatch.index).replace(/\n+$/, '');
                    const tail = existing.slice(semverHeadingMatch.index);
                    nextContent = head.length > 0 ? `${head}\n\n${section}${tail}` : `${section}${tail}`;
                }
                else {
                    const preamble = existing.trimEnd();
                    nextContent = preamble.length > 0 ? `${preamble}\n\n${section}` : section;
                }
            }
            nextContent = `${nextContent.replace(/\n+$/, '')}\n`;
            node_fs_1.default.mkdirSync(node_path_1.default.dirname(changelogPath), { recursive: true });
            node_fs_1.default.writeFileSync(changelogPath, nextContent, 'utf8');
            archiveConsumedFragments(config, ctx.version, ctx.fragments);
            return { releasePath: changelogPath };
        },
        hasVersion(config, version) {
            const rootDir = node_path_1.default.resolve(config.rootDir);
            const changelogPath = node_path_1.default.join(rootDir, changelogRelPath);
            if (!node_fs_1.default.existsSync(changelogPath)) {
                return false;
            }
            const source = node_fs_1.default.readFileSync(changelogPath, 'utf8');
            return versionHeadingRegex(version).test(source);
        },
        validate(config, version) {
            const rootDir = node_path_1.default.resolve(config.rootDir);
            const changelogPath = node_path_1.default.join(rootDir, changelogRelPath);
            if (!node_fs_1.default.existsSync(changelogPath)) {
                return [`Missing changelog: ${node_path_1.default.relative(rootDir, changelogPath)}.`];
            }
            const source = node_fs_1.default.readFileSync(changelogPath, 'utf8');
            if (!versionHeadingRegex(version).test(source)) {
                return [`${node_path_1.default.relative(rootDir, changelogPath)} is missing a "## ${version}" heading.`];
            }
            return [];
        },
    };
}
