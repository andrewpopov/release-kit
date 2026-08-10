/**
 * Release-hygiene classification — ported byte-for-byte from rouge's
 * `scripts/check-release-hygiene.js`. The classification LISTS come from
 * `config.hygiene`; the algorithm (git diff collection, path matching) is
 * generic.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { ReleaseKitConfig } from './config';
import { archiveDirPosix, notesDirPosix } from './config';
import { extractSummary, parseFrontMatter, validateFragmentContent } from './fragments';

export interface HygieneResult {
  ok: boolean;
  changedFiles: string[];
  hasPatchNoteUpdate: boolean;
  patchNoteFiles: string[];
  relevantFiles: string[];
  requiresPatchNote: boolean;
  /**
   * Patch-note files that are part of THIS change (i.e. present in
   * `patchNoteFiles`) and whose body is still the generated scaffold
   * placeholder. Scoped to changed fragments only — a ratchet, not a
   * retroactive check: a pre-existing placeholder fragment nobody touched
   * this change is never read, so it can't fail a push that didn't add it.
   * A fragment removed by this change (no longer on disk) is skipped too,
   * since there is no body left to check.
   */
  placeholderPatchNoteFiles: string[];
  /**
   * Patch-note files that are part of THIS change and whose summary ends in
   * `.` — the renderer emits `**{summary}:**`, so a trailing period renders
   * `**Summary.:**`. Same ratchet scoping as `placeholderPatchNoteFiles`: a
   * pre-existing trailing-period fragment nobody touched this change is
   * never read, and a fragment removed by this change is skipped.
   */
  trailingPeriodSummaryPatchNoteFiles: string[];
}

function normalizePath(filePath: string): string {
  return String(filePath || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map(normalizePath).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function gitLines(rootDir: string, args: string[]): string[] {
  try {
    const output = execFileSync('git', args, {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10000,
    });
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function resolveDiffBase(rootDir: string, baseRef: string): string {
  const ref = String(baseRef || '').trim();
  if (!ref) {
    return '';
  }
  const mergeBase = gitLines(rootDir, ['merge-base', 'HEAD', ref]);
  return mergeBase[0] || '';
}

export function collectChangedFiles(rootDir: string, baseRef: string): string[] {
  const files: string[] = [];
  const diffBase = resolveDiffBase(rootDir, baseRef);
  if (diffBase) {
    files.push(...gitLines(rootDir, ['diff', '--name-only', `${diffBase}...HEAD`]));
  }
  files.push(...gitLines(rootDir, ['diff', '--name-only', '--cached']));
  files.push(...gitLines(rootDir, ['diff', '--name-only']));
  files.push(...gitLines(rootDir, ['ls-files', '--others', '--exclude-standard']));
  return uniqueSorted(files);
}

function isFragmentFileName(filePath: string): boolean {
  const fileName = path.posix.basename(filePath);
  return fileName.endsWith('.md') && fileName !== 'README.md' && !fileName.startsWith('_');
}

export function isPatchNoteArtifact(config: ReleaseKitConfig, filePath: string): boolean {
  const normalized = normalizePath(filePath);
  if (!isFragmentFileName(normalized)) {
    return false;
  }
  return (
    normalized.startsWith(`${notesDirPosix(config)}/unreleased/`) ||
    normalized.startsWith(`${notesDirPosix(config)}/releases/`) ||
    // A cut moves consumed fragments into archive/<version>/ (see
    // archiveConsumedFragments in notes-target.ts) and empties unreleased/ —
    // it's the same fragment file, just relocated, so it still counts as the
    // patch-note artifact. Without this, no release branch can ever pass.
    normalized.startsWith(`${archiveDirPosix(config)}/`)
  );
}

/**
 * Default `hygiene.excludePatterns` — test files. Every consuming repo's
 * `relevantPrefixes` (e.g. `packages/web-app/src/`) sweeps in test files
 * living under the same tree (`src/**\/__tests__/**`, `*.test.ts`,
 * `*.spec.tsx`), so a change that adds ONLY tests was classified
 * release-relevant and blocked at push time for a change no user can
 * observe (PTRY-524).
 */
export const DEFAULT_HYGIENE_EXCLUDE_PATTERNS = ['**/__tests__/**', '**/__mocks__/**', '*.test.*', '*.spec.*'];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Converts a small glob subset (`**` = any number of path segments including
 * zero, `*` = any characters within one segment) to a RegExp. Handles a
 * leading `**` + `/` and a trailing `/` + `**` specially so a pattern like
 * `**` + `/__tests__/` + `**` also matches `__tests__/foo.ts` at the root
 * (zero leading/trailing segments) — a plain `**` -> `.*` substitution would
 * require a literal `/` on both sides and miss that case.
 */
function globToRegExp(glob: string): RegExp {
  let body = glob;
  let optionalPrefix = false;
  let optionalSuffix = false;
  if (body.startsWith('**/')) {
    optionalPrefix = true;
    body = body.slice(3);
  }
  if (body.endsWith('/**')) {
    optionalSuffix = true;
    body = body.slice(0, -3);
  }
  const DOUBLE_STAR = ' DOUBLE_STAR ';
  const SINGLE_STAR = ' SINGLE_STAR ';
  const tokenized = body.split('**').join(DOUBLE_STAR).split('*').join(SINGLE_STAR);
  const escaped = escapeRegExp(tokenized).split(DOUBLE_STAR).join('.*').split(SINGLE_STAR).join('[^/]*');
  const prefix = optionalPrefix ? '(?:.*/)?' : '';
  const suffix = optionalSuffix ? '(?:/.*)?' : '';
  return new RegExp(`^${prefix}${escaped}${suffix}$`);
}

/**
 * Whether `normalizedPath` matches a single `excludePatterns` glob. A
 * pattern containing `/` is matched against the full normalized path (it
 * names a directory shape, e.g. `**\/__tests__/**`); a pattern with no `/` is
 * matched against the basename only (it names a filename shape, e.g.
 * `*.test.*`), the same convention `.gitignore` uses — otherwise a bare
 * `*.test.*` could only ever match a file living at the repo root.
 */
export function matchesHygieneExcludePattern(pattern: string, normalizedPath: string): boolean {
  const target = pattern.includes('/') ? normalizedPath : path.posix.basename(normalizedPath);
  return globToRegExp(pattern).test(target);
}

function isExcludedFromRelevance(config: ReleaseKitConfig, normalizedPath: string): boolean {
  const patterns = config.hygiene.excludePatterns ?? DEFAULT_HYGIENE_EXCLUDE_PATTERNS;
  return patterns.some((pattern) => matchesHygieneExcludePattern(pattern, normalizedPath));
}

export function isReleaseRelevantFile(config: ReleaseKitConfig, filePath: string): boolean {
  const normalized = normalizePath(filePath);
  if (!normalized || isPatchNoteArtifact(config, normalized)) {
    return false;
  }
  const { relevantFiles, relevantDocFiles, relevantPrefixes, relevantScriptPrefixes } = config.hygiene;
  // Exact, curated file lists are a deliberate opt-in by the repo owner — a
  // default exclude pattern must never override that, so exclusion is
  // checked only for the broad prefix matches below (see the `excludePatterns`
  // doc comment on `HygieneConfig` for the full reasoning).
  if (relevantFiles.includes(normalized) || relevantDocFiles.includes(normalized)) {
    return true;
  }
  const matchesPrefix =
    relevantPrefixes.some((prefix) => normalized.startsWith(prefix)) ||
    relevantScriptPrefixes.some((prefix) => normalized.startsWith(prefix));
  return matchesPrefix && !isExcludedFromRelevance(config, normalized);
}

/**
 * Reads a changed patch-note fragment's summary/body off disk, or
 * `undefined` if it can't be read — deleted by this change, or not a
 * well-formed fragment. Either way there is nothing to validate, so callers
 * should skip it rather than fail hygiene on it (full front-matter
 * validation, e.g. kind/presence checks, is `check`/`publish`'s job, not
 * hygiene's).
 */
function readChangedFragmentContent(
  rootDir: string,
  relativeFilePath: string,
): { summary: string; body: string } | undefined {
  const absolutePath = path.resolve(rootDir, relativeFilePath);
  if (!fs.existsSync(absolutePath)) {
    return undefined;
  }
  try {
    const { meta, body } = parseFrontMatter(fs.readFileSync(absolutePath, 'utf8'), relativeFilePath);
    return { summary: extractSummary(meta), body };
  } catch {
    return undefined;
  }
}

export function classifyReleaseHygiene(config: ReleaseKitConfig, changedFiles: string[]): HygieneResult {
  const normalizedChangedFiles = uniqueSorted(changedFiles || []);
  const patchNoteFiles = normalizedChangedFiles.filter((file) => isPatchNoteArtifact(config, file));
  const relevantFiles = normalizedChangedFiles.filter((file) => isReleaseRelevantFile(config, file));
  const requiresPatchNote = relevantFiles.length > 0;
  const hasPatchNoteUpdate = patchNoteFiles.length > 0;
  const rootDir = path.resolve(config.rootDir);
  const changedFragmentIssues = patchNoteFiles.map((file) => {
    const content = readChangedFragmentContent(rootDir, file);
    return { file, issues: content ? validateFragmentContent(config, content) : [] };
  });
  const placeholderPatchNoteFiles = changedFragmentIssues
    .filter(({ issues }) => issues.some((issue) => issue.code === 'placeholder-body'))
    .map(({ file }) => file);
  const trailingPeriodSummaryPatchNoteFiles = changedFragmentIssues
    .filter(({ issues }) => issues.some((issue) => issue.code === 'trailing-period-summary'))
    .map(({ file }) => file);
  return {
    ok:
      (!requiresPatchNote || hasPatchNoteUpdate) &&
      placeholderPatchNoteFiles.length === 0 &&
      trailingPeriodSummaryPatchNoteFiles.length === 0,
    changedFiles: normalizedChangedFiles,
    hasPatchNoteUpdate,
    patchNoteFiles,
    relevantFiles,
    requiresPatchNote,
    placeholderPatchNoteFiles,
    trailingPeriodSummaryPatchNoteFiles,
  };
}

export interface CheckReleaseHygieneOptions {
  baseRef?: string;
}

export function checkReleaseHygiene(config: ReleaseKitConfig, options: CheckReleaseHygieneOptions = {}): HygieneResult {
  const rootDir = path.resolve(config.rootDir);
  const baseRef = options.baseRef || config.hygiene.baseRef;
  return classifyReleaseHygiene(config, collectChangedFiles(rootDir, baseRef));
}
