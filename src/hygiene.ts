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
  /**
   * Loud, non-fatal warnings about reduced coverage. Populated only when
   * `allowMissingHistory` downgraded an otherwise-fatal base-ref failure to
   * a working-tree-only check (see `checkReleaseHygiene`). Empty in the
   * normal case — `classifyReleaseHygiene` (which has no git access) always
   * returns `[]` here; `checkReleaseHygiene` fills it in.
   */
  warnings: string[];
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

/**
 * Why a git failure DURING hygiene must never be silently treated as "no
 * changes": the classification below (`ok`) is a straightforward function of
 * the changed-file set, so an empty set is indistinguishable from "nothing
 * changed" — a gate that can't tell "clean" apart from "broken" will report
 * clean. `kind` lets a caller (the CLI, or a programmatic consumer) give
 * targeted advice instead of a raw git stderr dump; `message` is already a
 * complete, actionable sentence on its own.
 */
export type HygieneGitFailureKind =
  | 'git-unavailable'
  | 'not-a-git-repo'
  | 'base-ref-not-found'
  | 'insufficient-history'
  | 'git-command-failed';

export class HygieneGitError extends Error {
  readonly kind: HygieneGitFailureKind;
  constructor(kind: HygieneGitFailureKind, message: string) {
    super(message);
    this.name = 'HygieneGitError';
    this.kind = kind;
  }
}

type GitExecError = NodeJS.ErrnoException & { status?: number | null; signal?: NodeJS.Signals | null; stderr?: string };

/** Classifies a failed `execFileSync('git', args, ...)` call for `runGit`'s callers (i.e. every git invocation except `merge-base`, which needs its own ref-aware classification — see `resolveDiffBase`). */
function classifyGitFailure(error: unknown, args: string[]): HygieneGitError {
  const err = error as GitExecError;
  const command = `git ${args.join(' ')}`;
  if (err && err.code === 'ENOENT') {
    return new HygieneGitError(
      'git-unavailable',
      `Release hygiene could not run \`${command}\`: the \`git\` executable was not found on PATH. Install git ` +
        '(or make sure it is on PATH) in whatever environment runs `release-kit hygiene` — the gate cannot check ' +
        'anything without it.',
    );
  }
  const stderr = String(err?.stderr || '').trim();
  if (/not a git repository/i.test(stderr)) {
    return new HygieneGitError(
      'not-a-git-repo',
      `Release hygiene could not run \`${command}\`: this directory is not inside a git repository (or its .git ` +
        'history was not included in the checkout). Run `release-kit hygiene` from within a git checkout of the repo.',
    );
  }
  return new HygieneGitError(
    'git-command-failed',
    `Release hygiene could not run \`${command}\`: ${stderr || err?.message || 'the git command failed for an unknown reason'}`,
  );
}

function runGit(rootDir: string, args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000,
    });
  } catch (error) {
    throw classifyGitFailure(error, args);
  }
}

function gitLines(rootDir: string, args: string[]): string[] {
  return runGit(rootDir, args)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Best-effort hint only for the `insufficient-history` message — never lets a failure here mask the primary git error. */
function isShallowRepo(rootDir: string): boolean {
  try {
    return (
      execFileSync('git', ['rev-parse', '--is-shallow-repository'], {
        cwd: rootDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 10000,
      }).trim() === 'true'
    );
  } catch {
    return false;
  }
}

/**
 * Resolves the merge-base commit `HEAD` diffs against, or `''` when `baseRef`
 * isn't configured (an explicit, existing opt-out — see `HygieneConfig.baseRef`'s
 * doc comment). A CONFIGURED ref that can't be resolved always throws: `git
 * merge-base`'s own exit-code contract distinguishes the two failure shapes
 * cleanly (per `git help merge-base`: status 1 means "no common ancestor
 * found", anything else is a hard error), so `status === 1` maps to
 * `insufficient-history` (the classic shallow-checkout shape: both refs exist
 * but share no history in THIS checkout) and a NORMAL (non-signal) non-1 exit
 * status maps to `base-ref-not-found` (bad ref name, or a ref never fetched
 * into this checkout — the two are not reliably distinguishable from git's
 * error text alone, so the message names both possible causes).
 *
 * A failure that DOESN'T fit either shape — `git merge-base` killed by a
 * signal (including a timeout: `execFileSync`'s own timeout kills the child
 * with SIGTERM, reported as a null `status` and a `signal`), or any other
 * error with no normal exit status at all — is classified `git-command-failed`
 * instead (PKG-140 finding C). This is NOT a cosmetic distinction:
 * `checkReleaseHygiene`'s `allowMissingHistory` opt-out rescues ONLY
 * `base-ref-not-found`/`insufficient-history`, so misclassifying a hung or
 * killed git process (or repo corruption, or any other hard failure) as
 * `base-ref-not-found` would let that opt-out silently rescue failures it was
 * never meant to cover — an unrecognized failure must fail closed regardless
 * of `allowMissingHistory`, which is the whole point of that flag being
 * narrow.
 */
function resolveDiffBase(rootDir: string, baseRef: string): string {
  const ref = String(baseRef || '').trim();
  if (!ref) {
    return '';
  }
  const args = ['merge-base', 'HEAD', ref];
  try {
    const output = execFileSync('git', args, {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000,
    });
    return (
      output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)[0] || ''
    );
  } catch (error) {
    const err = error as GitExecError;
    if (err && (err.code === 'ENOENT' || /not a git repository/i.test(String(err.stderr || '')))) {
      throw classifyGitFailure(error, args);
    }
    if (err && err.status === 1) {
      const shallow = isShallowRepo(rootDir);
      throw new HygieneGitError(
        'insufficient-history',
        `Release hygiene could not find a common ancestor between HEAD and base ref "${ref}" — ${
          shallow
            ? 'this checkout is shallow, so the history needed to compute the diff is missing.'
            : 'the two histories share no common commit reachable from this checkout.'
        } Fetch full history before running hygiene (e.g. \`actions/checkout\` with \`fetch-depth: 0\`, or \`git fetch --unshallow\`), or confirm "${ref}" is the right base ref.`,
      );
    }
    // See the doc comment above: only a NORMAL exit status (git ran to
    // completion and rejected the ref) is the bad-ref/never-fetched shape
    // `base-ref-not-found` names below. Anything else — killed by a signal,
    // timed out, or no exit status at all — did not run to completion for
    // some OTHER reason, so it must never be lumped in with (and therefore
    // rescuable as) a missing-history problem.
    if (!err || typeof err.status !== 'number' || err.signal) {
      const stderr = String(err?.stderr || '').trim();
      throw new HygieneGitError(
        'git-command-failed',
        `Release hygiene could not run \`git ${args.join(' ')}\`: ${
          stderr || err?.message || 'the process did not run to completion for an unrecognized reason'
        }. This is NOT a missing-history failure (a bad ref name or shallow checkout) — hygiene.allowMissingHistory ` +
          'does not cover it, so it fails closed regardless of that setting. Investigate the underlying git failure directly.',
      );
    }
    const stderr = String(err?.stderr || '').trim();
    throw new HygieneGitError(
      'base-ref-not-found',
      `Release hygiene could not resolve base ref "${ref}": ${stderr || err?.message || 'git merge-base failed'}. ` +
        `Verify the ref name, and that it has been fetched into this checkout — a shallow CI checkout (the default ` +
        `on most providers) usually fetches only the current branch. Fetch the base ref too, or use \`fetch-depth: 0\`.`,
    );
  }
}

/**
 * Collects the changed-file set hygiene classifies against. FAILS CLOSED:
 * any git failure (missing binary, not a repo, an unresolvable base ref,
 * insufficient history) throws a `HygieneGitError` instead of degrading to
 * an empty (falsely-passing) result — see `checkReleaseHygiene` for the one
 * explicit, opt-in way to downgrade a base-ref failure instead of failing.
 */
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
    warnings: [],
  };
}

export interface CheckReleaseHygieneOptions {
  baseRef?: string;
  /**
   * Explicit, opt-in escape hatch for a consumer that genuinely cannot
   * supply enough git history to compute a base-ref diff (see
   * `HygieneConfig.allowMissingHistory`'s doc comment for when that's a
   * legitimate situation vs. a checkout that should just fetch more history).
   * Never defaults to `true`. When `true` AND the failure is specifically
   * `base-ref-not-found` or `insufficient-history` (a history problem, not
   * "git doesn't work at all"), hygiene falls back to a working-tree-only
   * check and appends a warning to `HygieneResult.warnings` — it does NOT
   * silently pass; the reduced coverage is reported loudly. `git-unavailable`
   * and `not-a-git-repo` are never downgraded: those checkouts can't compute
   * ANY diff, base-ref or otherwise, so there is nothing to fall back to.
   */
  allowMissingHistory?: boolean;
}

export function checkReleaseHygiene(config: ReleaseKitConfig, options: CheckReleaseHygieneOptions = {}): HygieneResult {
  const rootDir = path.resolve(config.rootDir);
  const baseRef = options.baseRef || config.hygiene.baseRef;
  const allowMissingHistory = options.allowMissingHistory || config.hygiene.allowMissingHistory || false;
  const warnings: string[] = [];
  let changedFiles: string[];
  try {
    changedFiles = collectChangedFiles(rootDir, baseRef);
  } catch (error) {
    if (
      allowMissingHistory &&
      error instanceof HygieneGitError &&
      (error.kind === 'base-ref-not-found' || error.kind === 'insufficient-history')
    ) {
      warnings.push(
        `hygiene.allowMissingHistory is set: continuing WITHOUT a base-ref comparison against "${baseRef}" (${error.message}). ` +
          'Only working-tree, staged, and untracked changes are checked — commits already on this branch relative to ' +
          'the base ref are NOT covered by this run. Fix the underlying history problem when you can.',
      );
      changedFiles = collectChangedFiles(rootDir, '');
    } else {
      throw error;
    }
  }
  return { ...classifyReleaseHygiene(config, changedFiles), warnings };
}
