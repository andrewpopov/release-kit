"use strict";
/**
 * Release-note and patch-notes-index rendering — ported byte-for-byte from
 * rouge's `scripts/lib/release-notes-core.js`. `renderReleaseNote` is pure
 * given fragments + an injected date/commit. The title line (and its
 * parser) are driven by `config.titleTemplate` so they can never drift.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderReleaseNote = renderReleaseNote;
exports.parseReleaseSummary = parseReleaseSummary;
exports.renderPatchNotesIndex = renderPatchNotesIndex;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const config_1 = require("./config");
const fragments_1 = require("./fragments");
function renderReleaseNote(config, options) {
    const { version, date, fragments, commit = '' } = options;
    config.versionStrategy.assert(version);
    const lines = [
        (0, config_1.renderTitle)(config, version),
        '',
        `Release date: ${date}`,
        `Stage: ${config.stage}`,
        `Package version: ${version}`,
    ];
    if (commit) {
        lines.push(`Commit: ${commit}`);
    }
    lines.push('', (0, config_1.applyTemplate)(config.releaseNoteIntroTemplate, { notesDir: config.paths.notesDir }), '');
    if (fragments.length === 0) {
        lines.push('_No patch-note fragments were collected for this release._', '');
        return `${lines.join('\n')}\n`;
    }
    for (const kindDef of config.kinds) {
        const group = fragments.filter((fragment) => fragment.kind === kindDef.id);
        if (group.length === 0) {
            continue;
        }
        lines.push(`## ${kindDef.heading}`, '');
        for (const fragment of group) {
            lines.push(`- **${fragment.summary}:** ${(0, fragments_1.normalizeFragmentBody)(fragment.body)}`);
        }
        lines.push('');
    }
    return `${lines
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trimEnd()}\n`;
}
function parseReleaseSummary(config, filePath) {
    const source = node_fs_1.default.readFileSync(filePath, 'utf8');
    const titleMatch = source.match((0, config_1.titleRegExp)(config));
    const dateMatch = source.match(/^Release date:\s*(.+)$/m);
    const stageMatch = source.match(/^Stage:\s*(.+)$/m);
    const packageVersionMatch = source.match(/^Package version:\s*(.+)$/m);
    return {
        titleVersion: titleMatch ? titleMatch[1] : '',
        version: titleMatch ? titleMatch[1] : node_path_1.default.basename(filePath, '.md'),
        date: dateMatch ? dateMatch[1].trim() : '',
        stage: stageMatch ? stageMatch[1].trim() : '',
        packageVersion: packageVersionMatch ? packageVersionMatch[1].trim() : '',
        fileName: node_path_1.default.basename(filePath),
    };
}
function renderPatchNotesIndex(config, releases, version) {
    const lines = [
        `# ${config.productName} Patch Notes`,
        '',
        `${config.currentVersionLabel}: \`${version}\``,
        '',
        (0, config_1.applyTemplate)(config.indexIntroTemplate, {
            notesDir: config.paths.notesDir,
            publishCommand: config.hygiene.publishCommandHelp,
        }),
        '',
        '<!-- patch-notes:start -->',
        '## Releases',
        '',
    ];
    if (releases.length === 0) {
        lines.push('_No published patch notes yet._');
    }
    else {
        for (const release of releases) {
            const date = release.date ? ` - ${release.date}` : '';
            lines.push(`- [${release.version}](${(0, config_1.releaseLinkPath)(config, release.fileName)})${date}`);
        }
    }
    lines.push('<!-- patch-notes:end -->', '');
    return lines.join('\n');
}
