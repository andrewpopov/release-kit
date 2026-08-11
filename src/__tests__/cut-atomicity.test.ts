// PKG-140 finding 2: `cutRelease` used to bump the manifest, publish/archive
// fragments, THEN validate — a failure at any point after the first write
// (a malformed lockfile discovered mid-`writeVersion`, or a validation
// failure after publish/archive already succeeded) left the working tree
// half-mutated: version bumped, notes target partially written, fragments
// possibly moved into archive/. These tests force a failure at each stage
// that can fail AFTER the first write and assert the working tree is
// byte-for-byte unchanged afterwards — manifest, notes target, and fragment
// locations all restored.
//
// PKG-140 findings A/B/D (Codex review of the above): further tests assert
// that rollback itself cannot become a data-loss hazard — a failed source
// restore must never leave a fragment in NEITHER unreleased/ nor archive/
// (finding A), a legitimate concurrent edit made after the cut's own write
// must never be clobbered by rollback (finding B), and directories the cut
// created along the way must not survive a rollback as empty residue
// (finding D).

import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cutRelease } from '../publish';
import type { ReleaseKitConfig } from '../config';
import { stableSemver } from '../version';
import { npmPackage } from '../manifest';
import { changelogTarget } from '../notes-target';
import type { ReleaseNotesTarget } from '../notes-target';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'release-kit-cut-atomicity-'));
}

interface TreeSnapshot {
  files: Map<string, Buffer>;
  /** Relative POSIX-style paths of every directory under the root — see `assertTreeUnchanged` (PKG-140 finding D). */
  directories: Set<string>;
}

/** Recursively snapshots every regular file AND directory under `rootDir`. */
function snapshotTree(rootDir: string): TreeSnapshot {
  const files = new Map<string, Buffer>();
  const directories = new Set<string>();
  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(rootDir, fullPath).split(path.sep).join('/');
      if (entry.isDirectory()) {
        directories.add(relativePath);
        walk(fullPath);
      } else if (entry.isFile()) {
        files.set(relativePath, fs.readFileSync(fullPath));
      }
    }
  }
  walk(rootDir);
  return { files, directories };
}

/**
 * Asserts `rootDir`'s current file set AND every file's bytes match `before`
 * exactly (no new files, no missing files, no changed bytes) AND its
 * directory set matches too — a rolled-back cut must leave no empty
 * directory residue behind (PKG-140 finding D), which a files-only
 * comparison can never see.
 */
function assertTreeUnchanged(rootDir: string, before: TreeSnapshot): void {
  const after = snapshotTree(rootDir);
  expect([...after.files.keys()].sort()).toEqual([...before.files.keys()].sort());
  for (const [relativePath, originalContent] of before.files) {
    const currentContent = after.files.get(relativePath);
    expect(currentContent, `${relativePath} should exist after rollback`).toBeDefined();
    expect(currentContent!.equals(originalContent), `${relativePath} should have its original bytes after rollback`).toBe(true);
  }
  expect([...after.directories].sort(), 'no directory should be left behind (or removed) by rollback').toEqual(
    [...before.directories].sort(),
  );
}

function makeAtomicityConfig(rootDir: string, notesTarget: ReleaseNotesTarget = changelogTarget()): ReleaseKitConfig {
  return {
    productName: 'Atomicity App',
    stage: 'stable',
    rootDir,
    paths: { notesDir: 'docs/patch-notes', indexPath: 'docs/PATCH_NOTES.md' },
    kinds: [{ id: 'fixed', heading: 'Fixed' }],
    versionStrategy: stableSemver(),
    manifest: npmPackage(),
    hygiene: {
      baseRef: 'HEAD',
      relevantPrefixes: [],
      relevantFiles: [],
      relevantScriptPrefixes: [],
      relevantDocFiles: [],
      noteCommandHelp: 'npm run release:note',
      publishCommandHelp: 'npm run release:cut',
    },
    titleTemplate: '# {productName} {version}',
    versionLabel: 'Version',
    currentVersionLabel: 'Current version',
    fragmentBodyPlaceholder: 'Describe the change in one short paragraph before publishing.',
    releaseNoteIntroTemplate: 'Notes gathered from `{notesDir}/unreleased/`.',
    indexIntroTemplate: 'Notes gathered from `{notesDir}/unreleased/*.md`.',
    notesTarget,
  };
}

function writeFragment(rootDir: string): void {
  fs.mkdirSync(path.join(rootDir, 'docs', 'patch-notes', 'unreleased'), { recursive: true });
  fs.writeFileSync(
    path.join(rootDir, 'docs', 'patch-notes', 'unreleased', 'fixed-thing.md'),
    ['---', 'kind: fixed', 'summary: Fixed a thing', '---', '', 'A real impact paragraph.', ''].join('\n'),
    'utf8',
  );
}

describe('cutRelease atomicity (PKG-140 finding 2)', () => {
  test('a malformed lockfile fails BEFORE any write, and the tree is byte-for-byte unchanged', () => {
    const rootDir = makeTmpDir();
    try {
      fs.writeFileSync(path.join(rootDir, 'package.json'), `${JSON.stringify({ name: 'atomicity-app', version: '0.14.0' }, null, 2)}\n`, 'utf8');
      // Malformed: no `packages[""]`, which `npmPackage().writeVersion` requires.
      fs.writeFileSync(
        path.join(rootDir, 'package-lock.json'),
        `${JSON.stringify({ name: 'atomicity-app', version: '0.14.0', lockfileVersion: 3, packages: {} }, null, 2)}\n`,
        'utf8',
      );
      fs.writeFileSync(path.join(rootDir, 'CHANGELOG.md'), '# Changelog\n', 'utf8');
      writeFragment(rootDir);

      const config = makeAtomicityConfig(rootDir);
      const before = snapshotTree(rootDir);

      expect(() => cutRelease(config, { date: '2026-07-16' })).toThrow(/packages\[""\]\.version/);

      assertTreeUnchanged(rootDir, before);
      // Specifically: the fragment must still be at its original unreleased/ location, not archived.
      expect(fs.existsSync(path.join(rootDir, 'docs', 'patch-notes', 'unreleased', 'fixed-thing.md'))).toBe(true);
      expect(fs.existsSync(path.join(rootDir, 'docs', 'patch-notes', 'archive'))).toBe(false);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('a post-publish validation failure rolls back the bump, the changelog write, AND the fragment archive move', () => {
    const rootDir = makeTmpDir();
    try {
      fs.writeFileSync(path.join(rootDir, 'package.json'), `${JSON.stringify({ name: 'atomicity-app', version: '0.14.0' }, null, 2)}\n`, 'utf8');
      fs.writeFileSync(
        path.join(rootDir, 'package-lock.json'),
        `${JSON.stringify({ name: 'atomicity-app', version: '0.14.0', lockfileVersion: 3, packages: { '': { name: 'atomicity-app', version: '0.14.0' } } }, null, 2)}\n`,
        'utf8',
      );
      fs.writeFileSync(path.join(rootDir, 'CHANGELOG.md'), '# Changelog\n', 'utf8');
      writeFragment(rootDir);

      // publish/hasVersion/snapshot behave exactly like the real changelogTarget();
      // only validate() is forced to fail, simulating a validation problem that
      // only surfaces AFTER publish (and archiving) has already fully succeeded.
      const realTarget = changelogTarget();
      const forcedFailureTarget: ReleaseNotesTarget = {
        ...realTarget,
        validate: () => ['forced failure for the atomicity test'],
      };
      const config = makeAtomicityConfig(rootDir, forcedFailureTarget);
      const before = snapshotTree(rootDir);

      expect(() => cutRelease(config, { date: '2026-07-16' })).toThrow(/forced failure for the atomicity test/);

      assertTreeUnchanged(rootDir, before);
      // Specifically: the manifest must NOT be bumped...
      expect(JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')).version).toBe('0.14.0');
      expect(JSON.parse(fs.readFileSync(path.join(rootDir, 'package-lock.json'), 'utf8')).version).toBe('0.14.0');
      // ...the changelog must NOT contain the new version section...
      expect(fs.readFileSync(path.join(rootDir, 'CHANGELOG.md'), 'utf8')).not.toContain('## 0.14.1');
      // ...and the fragment must be back at its original unreleased/ location, not archived.
      expect(fs.existsSync(path.join(rootDir, 'docs', 'patch-notes', 'unreleased', 'fixed-thing.md'))).toBe(true);
      expect(fs.existsSync(path.join(rootDir, 'docs', 'patch-notes', 'archive', '0.14.1'))).toBe(false);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('a rollback that itself fails still reports the original validation failure as the primary error', () => {
    const rootDir = makeTmpDir();
    try {
      fs.writeFileSync(path.join(rootDir, 'package.json'), `${JSON.stringify({ name: 'atomicity-app', version: '0.14.0' }, null, 2)}\n`, 'utf8');
      fs.writeFileSync(path.join(rootDir, 'CHANGELOG.md'), '# Changelog\n', 'utf8');
      writeFragment(rootDir);

      const realTarget = changelogTarget();
      const forcedFailureTarget: ReleaseNotesTarget = {
        ...realTarget,
        validate: () => ['forced failure for the atomicity test'],
        // A guard whose restore() itself throws, simulating a rollback-time
        // failure (e.g. a file removed out from under it). commit() still
        // delegates to the real target's guard so the underlying files are
        // correctly recognized as "ours" before the simulated failure hits.
        snapshot: (config, ctx) => {
          const inner = realTarget.snapshot!(config, ctx);
          return {
            commit: () => inner.commit(),
            restore: () => {
              inner.restore();
              throw new Error('rollback storage unavailable');
            },
          };
        },
      };
      const config = makeAtomicityConfig(rootDir, forcedFailureTarget);

      let thrown: Error | undefined;
      try {
        cutRelease(config, { date: '2026-07-16' });
      } catch (error) {
        thrown = error as Error;
      }

      expect(thrown).toBeDefined();
      const message = thrown!.message;
      expect(message).toMatch(/forced failure for the atomicity test/);
      expect(message).toMatch(/rollback storage unavailable/);
      // Original failure must be primary: it appears before the rollback failure.
      expect(message.indexOf('forced failure for the atomicity test')).toBeLessThan(message.indexOf('rollback storage unavailable'));
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});

describe('cutRelease rollback safety (Codex review of PKG-140 finding 2)', () => {
  test('finding A: if the fragment source restore fails, the archive copy survives — the fragment is never left in NEITHER location', () => {
    const rootDir = makeTmpDir();
    try {
      fs.writeFileSync(path.join(rootDir, 'package.json'), `${JSON.stringify({ name: 'atomicity-app', version: '0.14.0' }, null, 2)}\n`, 'utf8');
      fs.writeFileSync(path.join(rootDir, 'CHANGELOG.md'), '# Changelog\n', 'utf8');
      writeFragment(rootDir);

      const unreleasedDir = path.join(rootDir, 'docs', 'patch-notes', 'unreleased');
      const archiveFragmentPath = path.join(rootDir, 'docs', 'patch-notes', 'archive', '0.14.1', 'fixed-thing.md');

      const realTarget = changelogTarget();
      const forcedFailureTarget: ReleaseNotesTarget = {
        ...realTarget,
        validate: () => {
          // By the time validate() runs, publish() has already archived the
          // (only) fragment, so unreleased/ is empty. Sabotage it so the
          // fragment's SOURCE restore fails deterministically: replace the
          // now-empty directory with a plain file at the same path, so
          // `mkdirSync(unreleasedDir, { recursive: true })` inside the
          // restore throws (ENOTDIR) instead of recreating the fragment.
          fs.rmdirSync(unreleasedDir);
          fs.writeFileSync(unreleasedDir, 'a file blocking the unreleased/ directory from being recreated', 'utf8');
          return ['forced failure for the atomicity test'];
        },
      };
      const config = makeAtomicityConfig(rootDir, forcedFailureTarget);

      expect(() => cutRelease(config, { date: '2026-07-16' })).toThrow();

      // The fragment must survive SOMEWHERE. Its source restore failed, so
      // the archive copy — the only other place it exists — must NOT have
      // been deleted.
      expect(fs.existsSync(archiveFragmentPath)).toBe(true);
    } finally {
      // `unreleasedDir` was replaced with a plain file by the sabotage above;
      // rmSync(recursive, force) handles a file-in-place-of-a-directory fine.
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('finding B: a concurrent edit written after the cut publishes survives rollback untouched, and is reported', () => {
    const rootDir = makeTmpDir();
    try {
      fs.writeFileSync(path.join(rootDir, 'package.json'), `${JSON.stringify({ name: 'atomicity-app', version: '0.14.0' }, null, 2)}\n`, 'utf8');
      fs.writeFileSync(path.join(rootDir, 'CHANGELOG.md'), '# Changelog\n', 'utf8');
      writeFragment(rootDir);

      const changelogPath = path.join(rootDir, 'CHANGELOG.md');
      const concurrentContent = '# Changelog\n\nA concurrent session wrote this line before rollback ran.\n';

      const realTarget = changelogTarget();
      const forcedFailureTarget: ReleaseNotesTarget = {
        ...realTarget,
        validate: () => {
          // Simulate a concurrent process legitimately modifying the
          // changelog AFTER our cut already wrote its own version section
          // into it, but BEFORE rollback runs.
          fs.writeFileSync(changelogPath, concurrentContent, 'utf8');
          return ['forced failure for the atomicity test'];
        },
      };
      const config = makeAtomicityConfig(rootDir, forcedFailureTarget);

      let thrown: Error | undefined;
      try {
        cutRelease(config, { date: '2026-07-16' });
      } catch (error) {
        thrown = error as Error;
      }

      expect(thrown).toBeDefined();
      // The concurrent edit must survive verbatim — rollback must NEVER
      // overwrite it back to the pre-cut "# Changelog\n".
      expect(fs.readFileSync(changelogPath, 'utf8')).toBe(concurrentContent);
      // ...and the operator must be told this file was deliberately left alone.
      expect(thrown!.message).toMatch(/CHANGELOG\.md/);
      expect(thrown!.message.toLowerCase()).toMatch(/left|skip|unchanged/);

      // Everything else the cut touched but that had NO conflict must still
      // roll back normally.
      expect(JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')).version).toBe('0.14.0');
      expect(fs.existsSync(path.join(rootDir, 'docs', 'patch-notes', 'unreleased', 'fixed-thing.md'))).toBe(true);
      expect(fs.existsSync(path.join(rootDir, 'docs', 'patch-notes', 'archive', '0.14.1'))).toBe(false);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('finding D: rollback removes directories the cut created along the way, leaving no empty residue', () => {
    const rootDir = makeTmpDir();
    try {
      fs.writeFileSync(path.join(rootDir, 'package.json'), `${JSON.stringify({ name: 'atomicity-app', version: '0.14.0' }, null, 2)}\n`, 'utf8');
      fs.writeFileSync(
        path.join(rootDir, 'package-lock.json'),
        `${JSON.stringify({ name: 'atomicity-app', version: '0.14.0', lockfileVersion: 3, packages: { '': { name: 'atomicity-app', version: '0.14.0' } } }, null, 2)}\n`,
        'utf8',
      );
      fs.writeFileSync(path.join(rootDir, 'CHANGELOG.md'), '# Changelog\n', 'utf8');
      // NOTE: writeFragment creates docs/patch-notes/unreleased/ but NOT
      // docs/patch-notes/archive/ — a successful cut would create
      // docs/patch-notes/archive/0.14.1/ from scratch to hold the archived
      // fragment. A rollback must remove that freshly-created chain, not
      // just the file inside it.
      writeFragment(rootDir);
      expect(fs.existsSync(path.join(rootDir, 'docs', 'patch-notes', 'archive'))).toBe(false);

      const realTarget = changelogTarget();
      const forcedFailureTarget: ReleaseNotesTarget = { ...realTarget, validate: () => ['forced failure for the atomicity test'] };
      const config = makeAtomicityConfig(rootDir, forcedFailureTarget);
      const before = snapshotTree(rootDir);

      expect(() => cutRelease(config, { date: '2026-07-16' })).toThrow(/forced failure for the atomicity test/);

      // The directory-aware comparison catches empty-directory residue that
      // a files-only tree comparison cannot see.
      assertTreeUnchanged(rootDir, before);
      expect(fs.existsSync(path.join(rootDir, 'docs', 'patch-notes', 'archive', '0.14.1'))).toBe(false);
      expect(fs.existsSync(path.join(rootDir, 'docs', 'patch-notes', 'archive'))).toBe(false);
      // The pre-existing parent directories are untouched either way.
      expect(fs.existsSync(path.join(rootDir, 'docs', 'patch-notes'))).toBe(true);
      expect(fs.existsSync(path.join(rootDir, 'docs', 'patch-notes', 'unreleased', 'fixed-thing.md'))).toBe(true);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
