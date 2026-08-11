// PKG-140 finding 2: `cutRelease` used to bump the manifest, publish/archive
// fragments, THEN validate — a failure at any point after the first write
// (a malformed lockfile discovered mid-`writeVersion`, or a validation
// failure after publish/archive already succeeded) left the working tree
// half-mutated: version bumped, notes target partially written, fragments
// possibly moved into archive/. These tests force a failure at each stage
// that can fail AFTER the first write and assert the working tree is
// byte-for-byte unchanged afterwards — manifest, notes target, and fragment
// locations all restored.

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

/** Recursively snapshots every regular file under `rootDir` as `{relativePosixPath: bytes}`. */
function snapshotTree(rootDir: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        files.set(path.relative(rootDir, fullPath).split(path.sep).join('/'), fs.readFileSync(fullPath));
      }
    }
  }
  walk(rootDir);
  return files;
}

/** Asserts `rootDir`'s current file set AND every file's bytes match `before` exactly — no new files, no missing files, no changed bytes. */
function assertTreeUnchanged(rootDir: string, before: Map<string, Buffer>): void {
  const after = snapshotTree(rootDir);
  expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
  for (const [relativePath, originalContent] of before) {
    const currentContent = after.get(relativePath);
    expect(currentContent, `${relativePath} should exist after rollback`).toBeDefined();
    expect(currentContent!.equals(originalContent), `${relativePath} should have its original bytes after rollback`).toBe(true);
  }
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
        // A snapshot whose restore function itself throws, simulating a
        // rollback-time failure (e.g. a file removed out from under it).
        snapshot: (config, ctx) => {
          const inner = realTarget.snapshot!(config, ctx);
          return () => {
            inner();
            throw new Error('rollback storage unavailable');
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
