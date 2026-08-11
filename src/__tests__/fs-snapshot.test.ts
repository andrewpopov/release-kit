// Unit coverage for the internal snapshot/rollback plumbing (`fs-snapshot.ts`)
// that PKG-140 finding 2's `cutRelease` atomicity, finding A's fragment-move
// safety, and finding B's conflict-aware restore all rely on.

import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { combineRestores, rollbackOnFailure, snapshotDirectory, snapshotFile } from '../fs-snapshot';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'release-kit-fs-snapshot-'));
}

describe('snapshotFile — uncommitted guard (no commit() call) always restores unconditionally', () => {
  test('restores an existing file to its exact original bytes after it is overwritten', () => {
    const dir = makeTmpDir();
    try {
      const filePath = path.join(dir, 'a.txt');
      fs.writeFileSync(filePath, 'original content\n', 'utf8');

      const guard = snapshotFile(filePath);
      fs.writeFileSync(filePath, 'mutated content\n', 'utf8');
      expect(fs.readFileSync(filePath, 'utf8')).toBe('mutated content\n');

      expect(guard.restore()).toEqual([]);
      expect(fs.readFileSync(filePath, 'utf8')).toBe('original content\n');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('removes a file that did not exist at snapshot time but was created afterward', () => {
    const dir = makeTmpDir();
    try {
      const filePath = path.join(dir, 'created-later.txt');
      const guard = snapshotFile(filePath);
      fs.writeFileSync(filePath, 'new file\n', 'utf8');
      expect(fs.existsSync(filePath)).toBe(true);

      expect(guard.restore()).toEqual([]);
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
      const guard = snapshotFile(filePath);
      fs.rmSync(filePath);
      expect(fs.existsSync(filePath)).toBe(false);

      expect(guard.restore()).toEqual([]);
      expect(fs.readFileSync(filePath, 'utf8')).toBe('move me\n');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('snapshotFile — committed guard is conflict-aware (PKG-140 finding B)', () => {
  test('restores normally when nothing touched the file after commit()', () => {
    const dir = makeTmpDir();
    try {
      const filePath = path.join(dir, 'a.txt');
      fs.writeFileSync(filePath, 'original\n', 'utf8');

      const guard = snapshotFile(filePath);
      fs.writeFileSync(filePath, 'our write\n', 'utf8');
      guard.commit();

      expect(guard.restore()).toEqual([]);
      expect(fs.readFileSync(filePath, 'utf8')).toBe('original\n');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('skips (does not overwrite) and reports a file a third party modified after commit()', () => {
    const dir = makeTmpDir();
    try {
      const filePath = path.join(dir, 'a.txt');
      fs.writeFileSync(filePath, 'original\n', 'utf8');

      const guard = snapshotFile(filePath);
      fs.writeFileSync(filePath, 'our write\n', 'utf8');
      guard.commit();

      // A concurrent process legitimately edits the file AFTER our commit.
      fs.writeFileSync(filePath, 'a concurrent third-party edit\n', 'utf8');

      const skipped = guard.restore();
      expect(skipped).toHaveLength(1);
      expect(skipped[0]).toContain(filePath);
      // The third party's content must survive verbatim — never clobbered
      // back to "original".
      expect(fs.readFileSync(filePath, 'utf8')).toBe('a concurrent third-party edit\n');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('skips deleting a file we created if a third party has since changed its contents (created-file case)', () => {
    const dir = makeTmpDir();
    try {
      const filePath = path.join(dir, 'created.txt');
      const guard = snapshotFile(filePath); // did not exist at snapshot time
      fs.writeFileSync(filePath, 'our new file\n', 'utf8');
      guard.commit();

      fs.writeFileSync(filePath, 'a concurrent third party wrote something here too\n', 'utf8');

      const skipped = guard.restore();
      expect(skipped).toHaveLength(1);
      // Must NOT have been deleted.
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, 'utf8')).toBe('a concurrent third party wrote something here too\n');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a partial write (commit() never reached) still restores unconditionally, not treated as a conflict', () => {
    const dir = makeTmpDir();
    try {
      const filePath = path.join(dir, 'a.txt');
      fs.writeFileSync(filePath, 'original\n', 'utf8');

      const guard = snapshotFile(filePath);
      // Simulate our own write landing, but the operation failing before
      // guard.commit() is ever reached (e.g. a sibling write threw right
      // after this one succeeded) — this must NOT be mistaken for a
      // stranger's edit; it's still purely OUR incomplete write.
      fs.writeFileSync(filePath, 'our own half-finished write\n', 'utf8');

      expect(guard.restore()).toEqual([]);
      expect(fs.readFileSync(filePath, 'utf8')).toBe('original\n');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('snapshotDirectory (PKG-140 finding D)', () => {
  test('removes a directory chain it created, once empty, on restore', () => {
    const dir = makeTmpDir();
    try {
      const nested = path.join(dir, 'a', 'b', 'c');
      const restore = snapshotDirectory(nested);
      fs.mkdirSync(nested, { recursive: true });
      expect(fs.existsSync(nested)).toBe(true);

      expect(restore()).toEqual([]);
      expect(fs.existsSync(path.join(dir, 'a'))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('never removes a directory that already existed before the snapshot', () => {
    const dir = makeTmpDir();
    try {
      const existing = path.join(dir, 'pre-existing');
      fs.mkdirSync(existing);
      const restore = snapshotDirectory(existing);

      expect(restore()).toEqual([]);
      expect(fs.existsSync(existing)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('leaves a created directory in place if it still holds something at restore time', () => {
    const dir = makeTmpDir();
    try {
      const nested = path.join(dir, 'a', 'b');
      const restore = snapshotDirectory(nested);
      fs.mkdirSync(nested, { recursive: true });
      fs.writeFileSync(path.join(nested, 'leftover.txt'), 'still here\n', 'utf8');

      expect(restore()).toEqual([]);
      expect(fs.existsSync(nested)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('combineRestores', () => {
  test('runs every restore even if one throws, and aggregates the failures', () => {
    const calls: string[] = [];
    const restores = [
      () => {
        calls.push('first');
        return [];
      },
      () => {
        calls.push('second');
        throw new Error('second failed');
      },
      () => {
        calls.push('third');
        return [];
      },
    ];

    expect(() => combineRestores(restores)()).toThrow(/second failed/);
    // All three ran despite the middle one throwing — nothing was skipped.
    expect(calls.sort()).toEqual(['first', 'second', 'third']);
  });

  test('does not throw when every restore succeeds', () => {
    const calls: string[] = [];
    const restores = [
      () => {
        calls.push('a');
        return [];
      },
      () => {
        calls.push('b');
        return [];
      },
    ];
    expect(() => combineRestores(restores)()).not.toThrow();
    expect(calls).toEqual(['b', 'a']); // reverse order: undo most-recent first
  });

  test('passes through skipped-path descriptions from every step', () => {
    const restores = [() => ['skipped-one'], () => ['skipped-two']];
    expect(combineRestores(restores)()).toEqual(['skipped-two', 'skipped-one']);
  });
});

describe('rollbackOnFailure', () => {
  test('rethrows the original error, unmodified, when rollback succeeds with nothing skipped', () => {
    const originalError = new Error('original failure');
    let restored = false;
    expect(() =>
      rollbackOnFailure(() => {
        restored = true;
        return [];
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

  test('reports skipped paths as a distinct, additive addendum to the original error (PKG-140 finding B)', () => {
    const originalError = new Error('validation failed');
    let thrown: Error | undefined;
    try {
      rollbackOnFailure(() => ['docs/CHANGELOG.md: left as found'], originalError);
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown).toBeDefined();
    const message = thrown!.message;
    expect(message.indexOf('validation failed')).toBeLessThan(message.indexOf('docs/CHANGELOG.md'));
    expect(message).toMatch(/docs\/CHANGELOG\.md: left as found/);
  });
});
