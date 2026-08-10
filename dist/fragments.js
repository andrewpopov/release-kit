"use strict";
/**
 * Fragment parsing/collection/creation — ported byte-for-byte from rouge's
 * `scripts/lib/release-notes-core.js`. Kind validation and ordering come
 * from `config.kinds` instead of a hardcoded list.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseFrontMatter = parseFrontMatter;
exports.slugify = slugify;
exports.todayIso = todayIso;
exports.isFragmentFile = isFragmentFile;
exports.isPlaceholderBody = isPlaceholderBody;
exports.extractSummary = extractSummary;
exports.validateFragmentContent = validateFragmentContent;
exports.parseFragment = parseFragment;
exports.collectFragments = collectFragments;
exports.normalizeFragmentBody = normalizeFragmentBody;
exports.writeNewFragment = writeNewFragment;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const config_1 = require("./config");
function parseFrontMatter(source, filePath = '<inline>') {
    const match = String(source || '')
        .replace(/\r\n/g, '\n')
        .match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!match) {
        throw new Error(`Patch-note fragment ${filePath} must start with YAML-style front matter.`);
    }
    const meta = {};
    for (const line of match[1].split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }
        const separatorIndex = trimmed.indexOf(':');
        if (separatorIndex === -1) {
            throw new Error(`Invalid front matter line in ${filePath}: ${line}`);
        }
        const key = trimmed.slice(0, separatorIndex).trim();
        const value = trimmed
            .slice(separatorIndex + 1)
            .trim()
            .replace(/^["']|["']$/g, '');
        meta[key] = value;
    }
    return { meta, body: match[2].trim() };
}
function slugify(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}
/** ISO date (`YYYY-MM-DD`) for `now` (defaults to the current time). */
function todayIso(now = new Date()) {
    return now.toISOString().slice(0, 10);
}
function isFragmentFile(fileName) {
    return fileName.endsWith('.md') && fileName !== 'README.md' && !fileName.startsWith('_');
}
function kindIds(kinds) {
    return new Set(kinds.map((kind) => kind.id));
}
/**
 * Whether `body` is still the generated scaffold placeholder (`note` writes
 * this exact text — see `writeNewFragment` below). Single definition shared
 * by `parseFragment` (used by `check`/`publish`) and `hygiene`'s ratchet
 * check, so the two can never disagree about what counts as unwritten.
 */
function isPlaceholderBody(config, body) {
    // Normalize BOTH sides: `parseFrontMatter` already folds CRLF to LF in the
    // file body, so comparing it against an unnormalized config string would
    // silently miss a multiline placeholder authored with CRLF.
    const normalize = (value) => String(value || '')
        .replace(/\r\n/g, '\n')
        .trim();
    const placeholder = normalize(config.fragmentBodyPlaceholder);
    // An unconfigured placeholder must never make every empty body "unwritten".
    if (!placeholder) {
        return false;
    }
    return normalize(body) === placeholder;
}
/**
 * Extracts a fragment's summary from parsed front matter (`summary`, falling
 * back to `title`). One definition shared by `parseFragment` and `hygiene`'s
 * changed-fragment validation so the two can never derive a different
 * summary for the same file.
 */
function extractSummary(meta) {
    return String(meta.summary || meta.title || '').trim();
}
/**
 * Content-quality checks that apply once a fragment has a non-empty summary
 * and body (presence is checked separately by `parseFragment`, since a
 * missing summary/body is a different failure mode with its own message).
 * Single definition shared by `parseFragment` (used by `check`/`publish`) and
 * `hygiene`'s ratchet check, so the two paths cannot drift apart on what
 * counts as an unwritten placeholder or an unrenderable summary — the exact
 * gap PTRY-509 closed for the placeholder rule and PTRY-526 closes for the
 * summary rule.
 */
function validateFragmentContent(config, content) {
    const issues = [];
    if (isPlaceholderBody(config, content.body)) {
        issues.push({
            code: 'placeholder-body',
            message: 'body is still the scaffold placeholder — write the real impact paragraph.',
        });
    }
    if (content.summary.endsWith('.')) {
        issues.push({
            code: 'trailing-period-summary',
            message: "summary must not end with '.' — the renderer emits '**{summary}:**'.",
        });
    }
    return issues;
}
function parseFragment(filePath, rootDir, config) {
    const relativePath = node_path_1.default.relative(rootDir, filePath);
    const { meta, body } = parseFrontMatter(node_fs_1.default.readFileSync(filePath, 'utf8'), relativePath);
    const kind = String(meta.kind || '').trim();
    const summary = extractSummary(meta);
    const validKindIds = kindIds(config.kinds);
    if (!validKindIds.has(kind)) {
        throw new Error(`${relativePath} has kind "${kind}". Expected one of: ${[...validKindIds].join(', ')}.`);
    }
    if (!summary) {
        throw new Error(`${relativePath} is missing a summary.`);
    }
    if (!body) {
        throw new Error(`${relativePath} needs a short body paragraph.`);
    }
    const [firstIssue] = validateFragmentContent(config, { summary, body });
    if (firstIssue) {
        throw new Error(`${relativePath} ${firstIssue.message}`);
    }
    return { filePath, fileName: node_path_1.default.basename(filePath), kind, summary, body };
}
function collectFragments(config) {
    const { rootDir, unreleasedDir } = (0, config_1.resolvePaths)(config);
    if (!node_fs_1.default.existsSync(unreleasedDir)) {
        return [];
    }
    return node_fs_1.default
        .readdirSync(unreleasedDir)
        .filter(isFragmentFile)
        .sort((left, right) => left.localeCompare(right))
        .map((fileName) => parseFragment(node_path_1.default.join(unreleasedDir, fileName), rootDir, config))
        .sort((left, right) => {
        const leftKind = config.kinds.findIndex((kind) => kind.id === left.kind);
        const rightKind = config.kinds.findIndex((kind) => kind.id === right.kind);
        return leftKind === rightKind ? left.fileName.localeCompare(right.fileName) : leftKind - rightKind;
    });
}
function normalizeFragmentBody(body) {
    return String(body || '')
        .split('\n')
        .map((line) => line.trim().replace(/^-\s+/, ''))
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function writeNewFragment(config, options) {
    const { rootDir, unreleasedDir } = (0, config_1.resolvePaths)(config);
    const kind = String(options.kind || config.kinds[0]?.id || '').trim();
    const slug = slugify(options.slug || options.summary);
    const summary = String(options.summary || '').trim();
    const validKindIds = kindIds(config.kinds);
    if (!validKindIds.has(kind)) {
        throw new Error(`Unknown kind "${kind}". Expected one of: ${[...validKindIds].join(', ')}.`);
    }
    if (!slug) {
        throw new Error('Missing --slug for the new patch-note fragment.');
    }
    if (!summary) {
        throw new Error('Missing --summary for the new patch-note fragment.');
    }
    node_fs_1.default.mkdirSync(unreleasedDir, { recursive: true });
    const filePath = node_path_1.default.join(unreleasedDir, `${kind}-${slug}.md`);
    if (node_fs_1.default.existsSync(filePath)) {
        throw new Error(`${node_path_1.default.relative(rootDir, filePath)} already exists.`);
    }
    node_fs_1.default.writeFileSync(filePath, ['---', `kind: ${kind}`, `summary: ${summary}`, '---', '', config.fragmentBodyPlaceholder, ''].join('\n'), 'utf8');
    return filePath;
}
