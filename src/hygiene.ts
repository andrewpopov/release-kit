/**
 * Release-hygiene classification — ported byte-for-byte from rouge's
 * `scripts/check-release-hygiene.js`. The classification LISTS come from
 * `config.hygiene`; the algorithm (git diff collection, path matching) is
 * generic.
 */

import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { ReleaseKitConfig } from './config';
import { notesDirPosix } from './config';

export interface HygieneResult {
  ok: boolean;
  changedFiles: string[];
  hasPatchNoteUpdate: boolean;
  patchNoteFiles: string[];
  relevantFiles: string[];
  requiresPatchNote: boolean;
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
    normalized.startsWith(`${notesDirPosix(config)}/releases/`)
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

export function classifyReleaseHygiene(config: ReleaseKitConfig, changedFiles: string[]): HygieneResult {
  const normalizedChangedFiles = uniqueSorted(changedFiles || []);
  const patchNoteFiles = normalizedChangedFiles.filter((file) => isPatchNoteArtifact(config, file));
  const relevantFiles = normalizedChangedFiles.filter((file) => isReleaseRelevantFile(config, file));
  const requiresPatchNote = relevantFiles.length > 0;
  const hasPatchNoteUpdate = patchNoteFiles.length > 0;
  return {
    ok: !requiresPatchNote || hasPatchNoteUpdate,
    changedFiles: normalizedChangedFiles,
    hasPatchNoteUpdate,
    patchNoteFiles,
    relevantFiles,
    requiresPatchNote,
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
