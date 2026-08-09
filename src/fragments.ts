/**
 * Fragment parsing/collection/creation — ported byte-for-byte from rouge's
 * `scripts/lib/release-notes-core.js`. Kind validation and ordering come
 * from `config.kinds` instead of a hardcoded list.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ReleaseKindDef, ReleaseKitConfig } from './config';
import { resolvePaths } from './config';

export interface Fragment {
  filePath: string;
  fileName: string;
  kind: string;
  summary: string;
  body: string;
}

export interface ParsedFrontMatter {
  meta: Record<string, string>;
  body: string;
}

export function parseFrontMatter(source: string, filePath = '<inline>'): ParsedFrontMatter {
  const match = String(source || '')
    .replace(/\r\n/g, '\n')
    .match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(`Patch-note fragment ${filePath} must start with YAML-style front matter.`);
  }
  const meta: Record<string, string> = {};
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

export function slugify(value: string | undefined | null): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** ISO date (`YYYY-MM-DD`) for `now` (defaults to the current time). */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function isFragmentFile(fileName: string): boolean {
  return fileName.endsWith('.md') && fileName !== 'README.md' && !fileName.startsWith('_');
}

function kindIds(kinds: ReleaseKindDef[]): Set<string> {
  return new Set(kinds.map((kind) => kind.id));
}

/**
 * Whether `body` is still the generated scaffold placeholder (`note` writes
 * this exact text — see `writeNewFragment` below). Single definition shared
 * by `parseFragment` (used by `check`/`publish`) and `hygiene`'s ratchet
 * check, so the two can never disagree about what counts as unwritten.
 */
export function isPlaceholderBody(config: ReleaseKitConfig, body: string | undefined | null): boolean {
  return String(body || '').trim() === String(config.fragmentBodyPlaceholder || '').trim();
}

export function parseFragment(filePath: string, rootDir: string, config: ReleaseKitConfig): Fragment {
  const relativePath = path.relative(rootDir, filePath);
  const { meta, body } = parseFrontMatter(fs.readFileSync(filePath, 'utf8'), relativePath);
  const kind = String(meta.kind || '').trim();
  const summary = String(meta.summary || meta.title || '').trim();
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
  if (isPlaceholderBody(config, body)) {
    throw new Error(
      `${relativePath} body is still the scaffold placeholder — write the real impact paragraph.`,
    );
  }
  if (summary.endsWith('.')) {
    throw new Error(`${relativePath} summary must not end with '.' — the renderer emits '**{summary}:**'.`);
  }
  return { filePath, fileName: path.basename(filePath), kind, summary, body };
}

export function collectFragments(config: ReleaseKitConfig): Fragment[] {
  const { rootDir, unreleasedDir } = resolvePaths(config);
  if (!fs.existsSync(unreleasedDir)) {
    return [];
  }
  return fs
    .readdirSync(unreleasedDir)
    .filter(isFragmentFile)
    .sort((left, right) => left.localeCompare(right))
    .map((fileName) => parseFragment(path.join(unreleasedDir, fileName), rootDir, config))
    .sort((left, right) => {
      const leftKind = config.kinds.findIndex((kind) => kind.id === left.kind);
      const rightKind = config.kinds.findIndex((kind) => kind.id === right.kind);
      return leftKind === rightKind ? left.fileName.localeCompare(right.fileName) : leftKind - rightKind;
    });
}

export function normalizeFragmentBody(body: string | undefined | null): string {
  return String(body || '')
    .split('\n')
    .map((line) => line.trim().replace(/^-\s+/, ''))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface WriteNewFragmentOptions {
  kind?: string;
  slug?: string;
  summary?: string;
}

export function writeNewFragment(config: ReleaseKitConfig, options: WriteNewFragmentOptions): string {
  const { rootDir, unreleasedDir } = resolvePaths(config);
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
  fs.mkdirSync(unreleasedDir, { recursive: true });
  const filePath = path.join(unreleasedDir, `${kind}-${slug}.md`);
  if (fs.existsSync(filePath)) {
    throw new Error(`${path.relative(rootDir, filePath)} already exists.`);
  }
  fs.writeFileSync(
    filePath,
    ['---', `kind: ${kind}`, `summary: ${summary}`, '---', '', config.fragmentBodyPlaceholder, ''].join('\n'),
    'utf8',
  );
  return filePath;
}
