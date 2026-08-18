// PKG-140 finding 1: `collectChangedFiles`/`checkReleaseHygiene` used to
// swallow every git failure and return an empty changed-file set, so an
// invalid or unavailable `baseRef` (very much including a shallow CI
// checkout — the default on most CI providers) made the hygiene gate PASS
// having checked nothing. These tests force each distinguishable failure
// mode and assert the gate FAILS CLOSED (throws / returns non-zero) instead
// of silently reporting "no changes".

import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkReleaseHygiene, collectChangedFiles, HygieneGitError } from '../hygiene';
import { run as runCli } from '../cli';
import { makeRougeConfig } from './fixtures/rougeConfig';

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeGitRoot(): string {
  const rootDir = makeTmpDir('release-kit-hygiene-fail-');
  fs.writeFileSync(path.join(rootDir, 'README.md'), '# Fixture\n', 'utf8');
  git(rootDir, ['init', '-q']);
  git(rootDir, ['config', 'user.email', 'review@example.com']);
  git(rootDir, ['config', 'user.name', 'Review']);
  git(rootDir, ['add', '.']);
  git(rootDir, ['commit', '-q', '-m', 'initial']);
  return rootDir;
}

/**
 * Reproduces the classic shallow-CI-checkout shape: an `origin` repo with a
 * `main` branch and a diverged `feature` branch, cloned with `--depth=1
 * --branch feature` (so only the tip of `feature` is present), then `main`
 * fetched ALSO at depth 1 (so `origin/main` resolves as a ref but shares no
 * history with `HEAD` in this checkout) — `git merge-base` on a clone built
 * this way exits 1 with no error text, which is the "insufficient history"
 * signature this test exercises.
 */
function makeShallowNoCommonAncestorRepo(): string {
  const originDir = makeTmpDir('release-kit-hygiene-origin-');
  git(originDir, ['init', '-q', '-b', 'main']);
  git(originDir, ['config', 'user.email', 'review@example.com']);
  git(originDir, ['config', 'user.name', 'Review']);
  for (let i = 0; i < 3; i += 1) {
    fs.writeFileSync(path.join(originDir, 'f.txt'), `line ${i}\n`, { flag: 'a' });
    git(originDir, ['add', '.']);
    git(originDir, ['commit', '-q', '-m', `commit ${i}`]);
  }
  git(originDir, ['branch', 'feature']);
  git(originDir, ['checkout', '-q', 'feature']);
  fs.writeFileSync(path.join(originDir, 'f.txt'), 'feature line\n', { flag: 'a' });
  git(originDir, ['add', '.']);
  git(originDir, ['commit', '-q', '-m', 'feature commit']);

  const cloneDir = makeTmpDir('release-kit-hygiene-shallow-');
  fs.rmdirSync(cloneDir);
  execFileSync('git', ['clone', '-q', '--depth=1', '--branch', 'feature', `file://${originDir}`, cloneDir], { stdio: 'ignore' });
  execFileSync('git', ['fetch', '-q', '--depth=1', 'origin', 'main:refs/remotes/origin/main'], { cwd: cloneDir, stdio: 'ignore' });
  return cloneDir;
}

/**
 * Builds a `git` shim directory and prepends it onto PATH so it shadows the
 * real `git`: every subcommand is passed straight through to the real `git`
 * EXCEPT `merge-base`, which self-terminates with SIGTERM instead of
 * running. This reproduces exactly what `execFileSync` reports for a
 * `merge-base` that's killed by a signal or times out (`status: null`,
 * `signal` set) — the "unrecognized, not a missing-history problem" shape
 * PKG-140 finding C is about — deterministically, instead of waiting out the
 * real 10s timeout. Note it is not instant: the shim's own `sleep 5` still
 * runs, so a test using it needs an explicit timeout above vitest's default.
 */
function makeMergeBaseKillingGitShim(): string {
  const realGitPath = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  const shimDir = makeTmpDir('release-kit-hygiene-shim-');
  fs.writeFileSync(
    path.join(shimDir, 'git'),
    ['#!/bin/sh', 'if [ "$1" = "merge-base" ]; then', '  kill -TERM $$', '  sleep 5', 'fi', `exec "${realGitPath}" "$@"`, ''].join('\n'),
    { mode: 0o755 },
  );
  return shimDir;
}

describe('hygiene fails CLOSED on git failures (PKG-140 finding 1)', () => {
  test('git binary unavailable throws git-unavailable and does NOT return an empty pass', () => {
    const rootDir = makeGitRoot();
    const originalPath = process.env.PATH;
    try {
      process.env.PATH = '/nonexistent-bin-dir-for-test';
      let caught: unknown;
      try {
        collectChangedFiles(rootDir, 'HEAD');
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(HygieneGitError);
      expect((caught as HygieneGitError).kind).toBe('git-unavailable');
      expect((caught as HygieneGitError).message).toMatch(/git.*executable.*not found/i);
    } finally {
      process.env.PATH = originalPath;
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('a non-git directory throws not-a-git-repo, not an empty pass', () => {
    const rootDir = makeTmpDir('release-kit-hygiene-notarepo-');
    try {
      let caught: unknown;
      try {
        collectChangedFiles(rootDir, 'HEAD');
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(HygieneGitError);
      expect((caught as HygieneGitError).kind).toBe('not-a-git-repo');
      expect((caught as HygieneGitError).message).toMatch(/not.*inside a git repository/i);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('an unresolvable base ref throws base-ref-not-found naming the fix', () => {
    const rootDir = makeGitRoot();
    try {
      let caught: unknown;
      try {
        collectChangedFiles(rootDir, 'totally-bogus-base-ref-xyz');
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(HygieneGitError);
      expect((caught as HygieneGitError).kind).toBe('base-ref-not-found');
      expect((caught as HygieneGitError).message).toMatch(/fetch-depth: 0|fetched into this checkout/i);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('a shallow checkout with no common ancestor throws insufficient-history naming fetch-depth: 0', () => {
    const cloneDir = makeShallowNoCommonAncestorRepo();
    try {
      let caught: unknown;
      try {
        collectChangedFiles(cloneDir, 'origin/main');
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(HygieneGitError);
      expect((caught as HygieneGitError).kind).toBe('insufficient-history');
      expect((caught as HygieneGitError).message).toMatch(/shallow/i);
      expect((caught as HygieneGitError).message).toMatch(/fetch-depth: 0/);
    } finally {
      fs.rmSync(cloneDir, { recursive: true, force: true });
    }
  });

  test('checkReleaseHygiene propagates the git failure instead of returning an empty passing result', () => {
    const rootDir = makeGitRoot();
    try {
      const config = makeRougeConfig(rootDir);
      expect(() => checkReleaseHygiene(config, { baseRef: 'totally-bogus-base-ref-xyz' })).toThrow(HygieneGitError);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('CLI hygiene exits 1 with an actionable message instead of "ok" on an unresolvable base ref', () => {
    const rootDir = makeGitRoot();
    try {
      const config = makeRougeConfig(rootDir);
      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];
      const stdout = { write: (chunk: unknown) => (stdoutChunks.push(String(chunk)), true) } as unknown as NodeJS.WritableStream;
      const stderr = { write: (chunk: unknown) => (stderrChunks.push(String(chunk)), true) } as unknown as NodeJS.WritableStream;

      const exitCode = runCli(['hygiene', '--base', 'totally-bogus-base-ref-xyz'], stdout, stderr, { config });

      expect(exitCode).toBe(1);
      expect(stdoutChunks.join('')).not.toMatch(/ok -/);
      expect(stderrChunks.join('')).toMatch(/release:hygiene:/);
      expect(stderrChunks.join('')).toMatch(/fetch-depth: 0|fetched into this checkout/i);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});

describe('hygiene.allowMissingHistory — explicit, opt-in, loud downgrade', () => {
  test('downgrades base-ref-not-found to a working-tree-only check and warns loudly', () => {
    const rootDir = makeGitRoot();
    try {
      const config = makeRougeConfig(rootDir);
      const result = checkReleaseHygiene(config, { baseRef: 'totally-bogus-base-ref-xyz', allowMissingHistory: true });
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.join('\n')).toMatch(/allowMissingHistory/);
      expect(result.warnings.join('\n')).toMatch(/NOT covered/);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('does NOT default to true — an unset config still fails closed', () => {
    const rootDir = makeGitRoot();
    try {
      const config = makeRougeConfig(rootDir);
      expect(config.hygiene.allowMissingHistory).toBeUndefined();
      expect(() => checkReleaseHygiene(config, { baseRef: 'totally-bogus-base-ref-xyz' })).toThrow(HygieneGitError);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('does NOT downgrade a not-a-git-repo failure even when allowMissingHistory is set — there is nothing to fall back to', () => {
    const rootDir = makeTmpDir('release-kit-hygiene-notarepo-optout-');
    try {
      const config = makeRougeConfig(rootDir);
      let caught: unknown;
      try {
        checkReleaseHygiene(config, { baseRef: 'HEAD', allowMissingHistory: true });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(HygieneGitError);
      expect((caught as HygieneGitError).kind).toBe('not-a-git-repo');
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('a passing hygiene run with allowMissingHistory set still reports ok:true alongside the warning', () => {
    const rootDir = makeGitRoot();
    try {
      const config = makeRougeConfig(rootDir);
      // Only docs/tests-shaped changes — no patch note required — so the
      // downgraded (working-tree-only) check should still pass overall.
      const result = checkReleaseHygiene(config, { baseRef: 'totally-bogus-base-ref-xyz', allowMissingHistory: true });
      expect(result.ok).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('an unrecognised (signal-terminated) merge-base failure fails closed even with allowMissingHistory enabled (PKG-140 finding C)', () => {
    const rootDir = makeGitRoot();
    const shimDir = makeMergeBaseKillingGitShim();
    const originalPath = process.env.PATH;
    try {
      process.env.PATH = `${shimDir}${path.delimiter}${originalPath}`;
      const config = makeRougeConfig(rootDir);
      let caught: unknown;
      try {
        checkReleaseHygiene(config, { baseRef: 'HEAD', allowMissingHistory: true });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(HygieneGitError);
      // The whole point: this must NOT be classified as one of the two
      // kinds allowMissingHistory is documented to rescue, so it must not
      // have been rescued — it has to reach the caller as a thrown error.
      expect((caught as HygieneGitError).kind).not.toBe('base-ref-not-found');
      expect((caught as HygieneGitError).kind).not.toBe('insufficient-history');
      expect((caught as HygieneGitError).kind).toBe('git-command-failed');
    } finally {
      process.env.PATH = originalPath;
      fs.rmSync(rootDir, { recursive: true, force: true });
      fs.rmSync(shimDir, { recursive: true, force: true });
    }
    // The shim self-terminates but still runs out its `sleep 5`, and hygiene
    // invokes `merge-base` twice, so this lands just over vitest's 5s default
    // and fails as a timeout rather than on its assertions. It has been red on
    // master, unnoticed, because this repo had no pre-push gate to run it.
  }, 30_000);
});
