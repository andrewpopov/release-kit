// Ported from rouge's tests/release-cut.test.ts (node:test -> vitest).

import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bumpVersion, cutRelease } from '../publish';
import { validateReleaseState } from '../publish';
import { makeRougeConfig } from './fixtures/rougeConfig';

function makeFixtureRoot(): string {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-kit-cut-'));
  fs.mkdirSync(path.join(rootDir, 'docs', 'patch-notes', 'releases'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'docs', 'patch-notes', 'unreleased'), { recursive: true });
  writePackageFiles(rootDir, '0.1.0-alpha.0');
  fs.writeFileSync(
    path.join(rootDir, 'docs', 'patch-notes', 'releases', '0.1.0-alpha.0.md'),
    [
      '# Angel Snack 0.1.0-alpha.0 Patch Notes',
      '',
      'Release date: 2026-07-04',
      'Stage: alpha',
      'Package version: 0.1.0-alpha.0',
      '',
      '## Operations',
      '',
      '- **Initial release:** Baseline alpha release.',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.writeFileSync(
    path.join(rootDir, 'docs', 'PATCH_NOTES.md'),
    [
      '# Angel Snack Patch Notes',
      '',
      'Current game version: `0.1.0-alpha.0`',
      '',
      '<!-- patch-notes:start -->',
      '## Releases',
      '',
      '- [0.1.0-alpha.0](patch-notes/releases/0.1.0-alpha.0.md) - 2026-07-04',
      '<!-- patch-notes:end -->',
      '',
    ].join('\n'),
    'utf8',
  );
  return rootDir;
}

function writePackageFiles(rootDir: string, version: string): void {
  fs.writeFileSync(
    path.join(rootDir, 'package.json'),
    `${JSON.stringify({ name: 'angel-snack', version }, null, 2)}\n`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(rootDir, 'package-lock.json'),
    `${JSON.stringify(
      { name: 'angel-snack', version, lockfileVersion: 3, packages: { '': { name: 'angel-snack', version } } },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

function writeFragment(rootDir: string): void {
  fs.writeFileSync(
    path.join(rootDir, 'docs', 'patch-notes', 'unreleased', 'ui-patch-notes-page.md'),
    ['---', 'kind: ui', 'summary: Patch notes page', '---', '', 'Added a public patch-notes page for released alpha builds.', ''].join(
      '\n',
    ),
    'utf8',
  );
}

describe('release-cut (ported from rouge)', () => {
  test('bumpVersion rejects an invalid explicit version before mutating either manifest', () => {
    const rootDir = makeFixtureRoot();
    try {
      const config = makeRougeConfig(rootDir);
      expect(() => bumpVersion(config, { version: 'not-a-release' })).toThrow(/alpha semver/);
      expect(JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')).version).toBe('0.1.0-alpha.0');
      expect(JSON.parse(fs.readFileSync(path.join(rootDir, 'package-lock.json'), 'utf8')).version).toBe('0.1.0-alpha.0');
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('cutRelease bumps, publishes, archives, and validates the next alpha', () => {
    const rootDir = makeFixtureRoot();
    try {
      writeFragment(rootDir);
      const config = makeRougeConfig(rootDir);

      const result = cutRelease(config, { date: '2026-07-05', commit: 'abc1234' });

      expect({
        previousVersion: result.previousVersion,
        version: result.version,
        fragmentCount: result.fragmentCount,
      }).toEqual({
        previousVersion: '0.1.0-alpha.0',
        version: '0.1.0-alpha.1',
        fragmentCount: 1,
      });
      expect(fs.existsSync(path.join(rootDir, 'docs', 'patch-notes', 'releases', '0.1.0-alpha.1.md'))).toBe(true);
      expect(
        fs.existsSync(path.join(rootDir, 'docs', 'patch-notes', 'archive', '0.1.0-alpha.1', 'ui-patch-notes-page.md')),
      ).toBe(true);
      expect(fs.existsSync(path.join(rootDir, 'docs', 'patch-notes', 'unreleased', 'ui-patch-notes-page.md'))).toBe(false);

      const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')) as { version: string };
      const lock = JSON.parse(fs.readFileSync(path.join(rootDir, 'package-lock.json'), 'utf8')) as {
        version: string;
        packages: { '': { version: string } };
      };
      expect(pkg.version).toBe('0.1.0-alpha.1');
      expect(lock.version).toBe('0.1.0-alpha.1');
      expect(lock.packages[''].version).toBe('0.1.0-alpha.1');
      expect(validateReleaseState(config).ok).toBe(true);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('cutRelease refuses empty releases before mutating package versions', () => {
    const rootDir = makeFixtureRoot();
    try {
      const config = makeRougeConfig(rootDir);
      expect(() => cutRelease(config, { date: '2026-07-05' })).toThrow(/No unreleased patch-note fragments/);
      const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')) as { version: string };
      expect(pkg.version).toBe('0.1.0-alpha.0');
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
