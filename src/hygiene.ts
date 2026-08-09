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
import { isPlaceholderBody, parseFrontMatter } from './fragments';

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

export function isReleaseRelevantFile(config: ReleaseKitConfig, filePath: string): boolean {
  const normalized = normalizePath(filePath);
  if (!normalized || isPatchNoteArtifact(config, normalized)) {
    return false;
  }
  const { relevantFiles, relevantDocFiles, relevantPrefixes, relevantScriptPrefixes } = config.hygiene;
  if (relevantFiles.includes(normalized) || relevantDocFiles.includes(normalized)) {
    return true;
  }
  if (relevantPrefixes.some((prefix) => normalized.startsWith(prefix))) {
    return true;
  }
  return relevantScriptPrefixes.some((prefix) => normalized.startsWith(prefix));
}

/**
 * Reads a changed patch-note fragment's body off disk, or `undefined` if it
 * can't be read — deleted by this change, or not a well-formed fragment.
 * Either way there is nothing to validate, so callers should skip it rather
 * than fail hygiene on it (full front-matter validation is `check`/
 * `publish`'s job, not hygiene's).
 */
function readChangedFragmentBody(rootDir: string, relativeFilePath: string): string | undefined {
  const absolutePath = path.resolve(rootDir, relativeFilePath);
  if (!fs.existsSync(absolutePath)) {
    return undefined;
  }
  try {
    return parseFrontMatter(fs.readFileSync(absolutePath, 'utf8'), relativeFilePath).body;
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
  const placeholderPatchNoteFiles = patchNoteFiles.filter((file) => {
    const body = readChangedFragmentBody(rootDir, file);
    return body !== undefined && isPlaceholderBody(config, body);
  });
  return {
    ok: (!requiresPatchNote || hasPatchNoteUpdate) && placeholderPatchNoteFiles.length === 0,
    changedFiles: normalizedChangedFiles,
    hasPatchNoteUpdate,
    patchNoteFiles,
    relevantFiles,
    requiresPatchNote,
    placeholderPatchNoteFiles,
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
