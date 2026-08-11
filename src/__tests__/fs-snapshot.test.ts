// Unit coverage for the internal snapshot/rollback plumbing (`fs-snapshot.ts`)
// that PKG-140 finding 2's `cutRelease` atomicity relies on.

import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { combineRestores, rollbackOnFailure, snapshotFile } from '../fs-snapshot';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'release-kit-fs-snapshot-'));
}

describe('snapshotFile', () => {
  test('restores an existing file to its exact original bytes after it is overwritten', () => {
    const dir = makeTmpDir();
    try {
      const filePath = path.join(dir, 'a.txt');
      fs.writeFileSync(filePath, 'original content\n', 'utf8');

      const restore = snapshotFile(filePath);
      fs.writeFileSync(filePath, 'mutated content\n', 'utf8');
      expect(fs.readFileSync(filePath, 'utf8')).toBe('mutated content\n');

      restore();
      expect(fs.readFileSync(filePath, 'utf8')).toBe('original content\n');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('removes a file that did not exist at snapshot time but was created afterward', () => {
    const dir = makeTmpDir();
    try {
      const filePath = path.join(dir, 'created-later.txt');
      const restore = snapshotFile(filePath);
      fs.writeFileSync(filePath, 'new file\n', 'utf8');
      expect(fs.existsSync(filePath)).toBe(true);

      restore();
      expect(fs.existsSync(filePath)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('recreates a file that existed at snapshot time but was deleted afterward', () => {
    const dir = makeTmpDir();
    try {
      const filePath = path.join(dir, 'moved-away.txt');
      fs.writeFileSync(filePath, 'move me\n', 'utf8');
      const restore = snapshotFile(filePath);
      fs.rmSync(filePath);
      expect(fs.existsSync(filePath)).toBe(false);

      restore();
      expect(fs.readFileSync(filePath, 'utf8')).toBe('move me\n');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('combineRestores', () => {
  test('runs every restore even if one throws, and aggregates the failures', () => {
    const calls: string[] = [];
    const restores = [
      () => calls.push('first'),
      () => {
        calls.push('second');
        throw new Error('second failed');
      },
      () => calls.push('third'),
    ];

    expect(() => combineRestores(restores)()).toThrow(/second failed/);
    // All three ran despite the middle one throwing — nothing was skipped.
    expect(calls.sort()).toEqual(['first', 'second', 'third']);
  });

  test('does not throw when every restore succeeds', () => {
    const calls: string[] = [];
    const restores = [() => calls.push('a'), () => calls.push('b')];
    expect(() => combineRestores(restores)()).not.toThrow();
    expect(calls).toEqual(['b', 'a']); // reverse order: undo most-recent first
  });
});

describe('rollbackOnFailure', () => {
  test('rethrows the original error, unmodified, when rollback succeeds', () => {
    const originalError = new Error('original failure');
    let restored = false;
    expect(() =>
      rollbackOnFailure(() => {
        restored = true;
      }, originalError),
    ).toThrow('original failure');
    expect(restored).toBe(true);
  });

  test('a failing rollback appends its failure to (never masks) the original error, original first', () => {
    const originalError = new Error('original failure — the real bug');
    let thrown: Error | undefined;
    try {
      rollbackOnFailure(() => {
        throw new Error('rollback also failed');
      }, originalError);
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown).toBeDefined();
    const message = thrown!.message;
    // The original error must be the PRIMARY content, appearing before the
    // rollback failure, not replaced by it.
    expect(message.indexOf('original failure — the real bug')).toBeLessThan(message.indexOf('rollback also failed'));
    expect(message).toMatch(/rollback also failed/);
  });
});
