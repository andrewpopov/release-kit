import fs from 'node:fs';
import path from 'node:path';

export const RELEASE_SUMMARY_MAX_CHARACTERS = 360;

/** A user-facing release, scoped to one repository. Keep operational details out of notes. */
export interface ReleaseNotesRecord {
  schemaVersion: 1;
  repository: string;
  id: string;
  product: string;
  version: string;
  commit: string;
  releasedAt: string;
  summary: string;
  notesMarkdown: string;
}

export interface ReleaseNotesPage {
  items: ReleaseNotesRecord[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface ReleaseNotesReader {
  get(repository: string, id: string): Promise<ReleaseNotesRecord | null>;
  list(repository: string, query?: { page?: number; pageSize?: number }): Promise<ReleaseNotesPage>;
}

export interface ReleaseNotesFiles {
  /** Absolute host-owned directory. Only dated .md files are read. */
  directory: string;
  repository: string;
  product: string;
}

function text(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new Error(`Release ${name} must be nonempty text of at most ${max} characters.`);
  }
  return value;
}

function repositoryName(value: unknown): string {
  const name = text(value, 'repository', 200);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(name)) {
    throw new Error('Release repository must be owner/name.');
  }
  return name;
}

function releaseId(value: unknown): string {
  const id = text(value, 'id', 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) throw new Error('Invalid release id.');
  return id;
}

export function validateReleaseNotesRecord(value: unknown): ReleaseNotesRecord {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid release record.');
  const r = value as Record<string, unknown>;
  if (r.schemaVersion !== 1) throw new Error('Unsupported release record schema.');
  const releasedAt = text(r.releasedAt, 'date', 30);
  if (!Number.isFinite(Date.parse(releasedAt))) throw new Error('Invalid release date.');
  // Normalize ordering and timestamp once so equality is independent of object key order.
  return {
    schemaVersion: 1,
    repository: repositoryName(r.repository),
    id: releaseId(r.id),
    product: text(r.product, 'product', 120),
    version: text(r.version, 'version', 128),
    commit: text(r.commit, 'commit', 64),
    releasedAt: new Date(releasedAt).toISOString(),
    summary: text(r.summary, 'summary', RELEASE_SUMMARY_MAX_CHARACTERS),
    notesMarkdown: text(r.notesMarkdown, 'notes', 200_000),
  };
}

function fileName(id: string): string {
  const name = releaseId(id);
  if (!/^\d{4}-\d{2}-\d{2}[-.]/.test(name)) throw new Error('Release id must start with YYYY-MM-DD-.');
  return `${name}.md`;
}

function readFile(file: string, options: ReleaseNotesFiles): ReleaseNotesRecord {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size > 1_000_000) throw new Error('Invalid release note file.');
  const source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const match = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`Release ${path.basename(file)} needs front matter.`);
  const meta: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon < 1) throw new Error('Invalid release front matter.');
    const value = line.slice(colon + 1).trim();
    meta[line.slice(0, colon).trim()] = value.startsWith('"') ? JSON.parse(value) as string : value;
  }
  return validateReleaseNotesRecord({
    schemaVersion: 1, repository: options.repository, product: options.product,
    id: path.basename(file, '.md'), version: meta.version, commit: meta.commit,
    releasedAt: meta.releasedAt, summary: meta.summary, notesMarkdown: match[2].trim(),
  });
}

/** Also usable at build time to produce a static manifest for non-Node hosts. */
export function readDatedReleaseNotes(options: ReleaseNotesFiles): ReleaseNotesRecord[] {
  const directory = path.resolve(options.directory);
  let names: string[];
  try { names = fs.readdirSync(directory); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return [];
  }
  return names.filter(name => /^\d{4}-\d{2}-\d{2}[-.][A-Za-z0-9._-]+\.md$/.test(name))
    .map(name => readFile(path.join(directory, name), options))
    .sort((a, b) => b.releasedAt.localeCompare(a.releasedAt) || b.id.localeCompare(a.id));
}

/** Reads the deployed repo's reviewed notes; no network request or database is needed. */
export function createFileReleaseNotesReader(options: ReleaseNotesFiles): ReleaseNotesReader {
  repositoryName(options.repository);
  const directory = path.resolve(options.directory);
  return {
    async get(repository, id) {
      if (repository !== options.repository) return null;
      const file = path.join(directory, fileName(id));
      try { return readFile(file, options); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    async list(repository, { page = 1, pageSize = 20 } = {}) {
      if (!Number.isSafeInteger(page) || page < 1 || page > 100_000 ||
          !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50) {
        throw new Error('Invalid release page.');
      }
      if (repository !== options.repository) return { items: [], page, pageSize, hasMore: false };
      const records = readDatedReleaseNotes(options);
      const start = (page - 1) * pageSize;
      return { items: records.slice(start, start + pageSize), page, pageSize, hasMore: records.length > start + pageSize };
    },
  };
}

/** Write during a release PR, then commit the file; runtime readers never call this. */
export function writeDatedReleaseNotes(directory: string, input: ReleaseNotesRecord): string {
  const record = validateReleaseNotesRecord(input);
  const file = path.join(path.resolve(directory), fileName(record.id));
  const metadata = ['version', 'commit', 'releasedAt', 'summary'] as const;
  const content = `---\n${metadata.map(key => `${key}: ${JSON.stringify(record[key])}`).join('\n')}\n---\n\n${record.notesMarkdown.trim()}\n`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try { fs.writeFileSync(file, content, { encoding: 'utf8', flag: 'wx' }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const stored = readFile(file, { directory, repository: record.repository, product: record.product });
    if (JSON.stringify(stored) !== JSON.stringify({ ...record, notesMarkdown: record.notesMarkdown.trim() })) {
      throw new Error(`Release ${record.id} already exists with different notes.`);
    }
  }
  return file;
}

export function releaseNotesUrl(baseUrl: string, id: string): string {
  const url = new URL(baseUrl);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Release notes base must be an HTTP(S) URL without credentials, query or fragment.');
  }
  url.pathname = `${url.pathname.replace(/\/$/, '')}/${encodeURIComponent(releaseId(id))}`;
  return url.href;
}

export interface ReleaseNotification {
  title: string;
  summary: string;
  url: string;
}

/** Both Discord and other webhooks use the same bounded summary and stable link. */
export function buildReleaseNotification(record: ReleaseNotesRecord, notesBaseUrl: string): ReleaseNotification {
  const checked = validateReleaseNotesRecord(record);
  return { title: `${checked.product} ${checked.version}`, summary: checked.summary,
    url: releaseNotesUrl(notesBaseUrl, checked.id) };
}
