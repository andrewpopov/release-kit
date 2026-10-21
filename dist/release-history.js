"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RELEASE_SUMMARY_MAX_CHARACTERS = void 0;
exports.validateReleaseNotesRecord = validateReleaseNotesRecord;
exports.readDatedReleaseNotes = readDatedReleaseNotes;
exports.createFileReleaseNotesReader = createFileReleaseNotesReader;
exports.writeDatedReleaseNotes = writeDatedReleaseNotes;
exports.releaseNotesUrl = releaseNotesUrl;
exports.buildReleaseNotification = buildReleaseNotification;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
exports.RELEASE_SUMMARY_MAX_CHARACTERS = 360;
function text(value, name, max) {
    if (typeof value !== 'string' || !value.trim() || value.length > max) {
        throw new Error(`Release ${name} must be nonempty text of at most ${max} characters.`);
    }
    return value;
}
function repositoryName(value) {
    const name = text(value, 'repository', 200);
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(name)) {
        throw new Error('Release repository must be owner/name.');
    }
    return name;
}
function releaseId(value) {
    const id = text(value, 'id', 128);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id))
        throw new Error('Invalid release id.');
    return id;
}
function validateReleaseNotesRecord(value) {
    if (typeof value !== 'object' || value === null)
        throw new Error('Invalid release record.');
    const r = value;
    if (r.schemaVersion !== 1)
        throw new Error('Unsupported release record schema.');
    const releasedAt = text(r.releasedAt, 'date', 30);
    if (!Number.isFinite(Date.parse(releasedAt)))
        throw new Error('Invalid release date.');
    // Normalize ordering and timestamp once so equality is independent of object key order.
    return {
        schemaVersion: 1,
        repository: repositoryName(r.repository),
        id: releaseId(r.id),
        product: text(r.product, 'product', 120),
        version: text(r.version, 'version', 128),
        commit: text(r.commit, 'commit', 64),
        releasedAt: new Date(releasedAt).toISOString(),
        summary: text(r.summary, 'summary', exports.RELEASE_SUMMARY_MAX_CHARACTERS),
        notesMarkdown: text(r.notesMarkdown, 'notes', 200000),
    };
}
function fileName(id) {
    const name = releaseId(id);
    if (!/^\d{4}-\d{2}-\d{2}[-.]/.test(name))
        throw new Error('Release id must start with YYYY-MM-DD-.');
    return `${name}.md`;
}
function readFile(file, options) {
    const stat = node_fs_1.default.lstatSync(file);
    if (!stat.isFile() || stat.size > 1000000)
        throw new Error('Invalid release note file.');
    const source = node_fs_1.default.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const match = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match)
        throw new Error(`Release ${node_path_1.default.basename(file)} needs front matter.`);
    const meta = {};
    for (const line of match[1].split('\n')) {
        if (!line.trim() || line.trim().startsWith('#'))
            continue;
        const colon = line.indexOf(':');
        if (colon < 1)
            throw new Error('Invalid release front matter.');
        const value = line.slice(colon + 1).trim();
        meta[line.slice(0, colon).trim()] = value.startsWith('"') ? JSON.parse(value) : value;
    }
    return validateReleaseNotesRecord({
        schemaVersion: 1, repository: options.repository, product: options.product,
        id: node_path_1.default.basename(file, '.md'), version: meta.version, commit: meta.commit,
        releasedAt: meta.releasedAt, summary: meta.summary, notesMarkdown: match[2].trim(),
    });
}
/** Also usable at build time to produce a static manifest for non-Node hosts. */
function readDatedReleaseNotes(options) {
    const directory = node_path_1.default.resolve(options.directory);
    let names;
    try {
        names = node_fs_1.default.readdirSync(directory);
    }
    catch (error) {
        if (error.code !== 'ENOENT')
            throw error;
        return [];
    }
    return names.filter(name => /^\d{4}-\d{2}-\d{2}[-.][A-Za-z0-9._-]+\.md$/.test(name))
        .map(name => readFile(node_path_1.default.join(directory, name), options))
        .sort((a, b) => b.releasedAt.localeCompare(a.releasedAt) || b.id.localeCompare(a.id));
}
/** Reads the deployed repo's reviewed notes; no network request or database is needed. */
function createFileReleaseNotesReader(options) {
    repositoryName(options.repository);
    const directory = node_path_1.default.resolve(options.directory);
    return {
        async get(repository, id) {
            if (repository !== options.repository)
                return null;
            const file = node_path_1.default.join(directory, fileName(id));
            try {
                return readFile(file, options);
            }
            catch (error) {
                if (error.code === 'ENOENT')
                    return null;
                throw error;
            }
        },
        async list(repository, { page = 1, pageSize = 20 } = {}) {
            if (!Number.isSafeInteger(page) || page < 1 || page > 100000 ||
                !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50) {
                throw new Error('Invalid release page.');
            }
            if (repository !== options.repository)
                return { items: [], page, pageSize, hasMore: false };
            const records = readDatedReleaseNotes(options);
            const start = (page - 1) * pageSize;
            return { items: records.slice(start, start + pageSize), page, pageSize, hasMore: records.length > start + pageSize };
        },
    };
}
/** Write during a release PR, then commit the file; runtime readers never call this. */
function writeDatedReleaseNotes(directory, input) {
    const record = validateReleaseNotesRecord(input);
    const file = node_path_1.default.join(node_path_1.default.resolve(directory), fileName(record.id));
    const metadata = ['version', 'commit', 'releasedAt', 'summary'];
    const content = `---\n${metadata.map(key => `${key}: ${JSON.stringify(record[key])}`).join('\n')}\n---\n\n${record.notesMarkdown.trim()}\n`;
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(file), { recursive: true });
    try {
        node_fs_1.default.writeFileSync(file, content, { encoding: 'utf8', flag: 'wx' });
    }
    catch (error) {
        if (error.code !== 'EEXIST')
            throw error;
        const stored = readFile(file, { directory, repository: record.repository, product: record.product });
        if (JSON.stringify(stored) !== JSON.stringify({ ...record, notesMarkdown: record.notesMarkdown.trim() })) {
            throw new Error(`Release ${record.id} already exists with different notes.`);
        }
    }
    return file;
}
function releaseNotesUrl(baseUrl, id) {
    const url = new URL(baseUrl);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error('Release notes base must be an HTTP(S) URL without credentials, query or fragment.');
    }
    url.pathname = `${url.pathname.replace(/\/$/, '')}/${encodeURIComponent(releaseId(id))}`;
    return url.href;
}
/** Both Discord and other webhooks use the same bounded summary and stable link. */
function buildReleaseNotification(record, notesBaseUrl) {
    const checked = validateReleaseNotesRecord(record);
    return { title: `${checked.product} ${checked.version}`, summary: checked.summary,
        url: releaseNotesUrl(notesBaseUrl, checked.id) };
}
