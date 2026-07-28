// Ported from rouge's tests/release-cut.test.ts (node:test -> vitest).

import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bumpVersion, cutRelease } from '../publish';
import { validateReleaseState } from '../publish';
import { makeRougeConfig } from './fixtures/rougeConfig';
import type { ReleaseKitConfig } from '../config';
import type { VersionStrategy } from '../version';
import { stableSemver } from '../version';
import { npmPackage } from '../manifest';
import { changelogTarget } from '../notes-target';

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

function makeStableFixtureRoot(version: string): string {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-kit-stable-'));
  fs.mkdirSync(path.join(rootDir, 'docs', 'patch-notes', 'unreleased'), { recursive: true });
  fs.writeFileSync(
    path.join(rootDir, 'package.json'),
    `${JSON.stringify({ name: 'stable-app', version }, null, 2)}\n`,
    'utf8',
  );
  return rootDir;
}

function writeStableFragment(rootDir: string, kind: string, fileName: string, summary: string): void {
  fs.writeFileSync(
    path.join(rootDir, 'docs', 'patch-notes', 'unreleased', fileName),
    ['---', `kind: ${kind}`, `summary: ${summary}`, '---', '', 'Body text for the fragment.', ''].join('\n'),
    'utf8',
  );
}

function makeStableConfig(rootDir: string, versionStrategy: VersionStrategy): ReleaseKitConfig {
  return {
    productName: 'Stable App',
    stage: 'stable',
    rootDir,
    paths: {
      notesDir: 'docs/patch-notes',
      indexPath: 'docs/PATCH_NOTES.md',
    },
    kinds: [
      { id: 'breaking', heading: 'Breaking' },
      { id: 'added', heading: 'Added' },
      { id: 'fixed', heading: 'Fixed' },
    ],
    versionStrategy,
    manifest: npmPackage(),
    hygiene: {
      baseRef: 'origin/master',
      relevantPrefixes: [],
      relevantFiles: [],
      relevantScriptPrefixes: [],
      relevantDocFiles: [],
      noteCommandHelp: 'npm run release:note',
      publishCommandHelp: 'npm run release:publish',
    },
    titleTemplate: '# {productName} {version}',
    versionLabel: 'Version',
    currentVersionLabel: 'Current version',
    fragmentBodyPlaceholder: 'Describe the change in one short paragraph before publishing.',
    releaseNoteIntroTemplate: 'Notes gathered from `{notesDir}/unreleased/`.',
    indexIntroTemplate: 'Notes gathered from `{notesDir}/unreleased/*.md`.',
    notesTarget: changelogTarget(),
  };
}

/** A pre-existing (legacy) version strategy that never declares `bumpLevelSupport`. */
function makeLegacyPatchStrategy(): VersionStrategy {
  return {
    assert(version: string): void {
      if (!/^\d+\.\d+\.\d+$/.test(version)) {
        throw new Error(`Version "${version}" must be X.Y.Z.`);
      }
    },
    next(version: string): string {
      const [major, minor, patch] = version.split('.').map(Number);
      return `${major}.${minor}.${patch + 1}`;
    },
    compareDesc(a, b): number {
      return String(b.version).localeCompare(String(a.version));
    },
    releaseFileName(version: string): string {
      return `${version}.md`;
    },
  };
}

describe('release-cut: fragment-derived semver bump (PKG-96)', () => {
  test('cutRelease with a breaking fragment derives a MINOR bump, not the old unconditional patch', () => {
    const rootDir = makeStableFixtureRoot('0.14.0');
    try {
      writeStableFragment(rootDir, 'breaking', 'breaking-thing.md', 'Breaking change summary');
      const config = makeStableConfig(rootDir, stableSemver());

      const result = cutRelease(config, { date: '2026-07-16' });

      expect(result.version).toBe('0.15.0');
      expect(result.version).not.toBe('0.14.1');
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('bumpVersion with an explicit version does not collect fragments (a malformed fragment does not block it)', () => {
    const rootDir = makeStableFixtureRoot('1.0.0');
    try {
      writeStableFragment(rootDir, 'not-a-real-kind', 'malformed.md', 'Bad fragment');
      const config = makeStableConfig(rootDir, stableSemver());

      const result = bumpVersion(config, { version: '5.0.0' });

      expect(result.version).toBe('5.0.0');
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('refuses an implicit major cut when the version strategy does not declare bumpLevelSupport, naming the offending fragment', () => {
    const rootDir = makeStableFixtureRoot('0.14.0');
    try {
      writeStableFragment(rootDir, 'breaking', 'breaking-thing.md', 'Breaking change summary');
      const config = makeStableConfig(rootDir, makeLegacyPatchStrategy());

      expect(() => cutRelease(config, { date: '2026-07-16' })).toThrow(
        /Refusing to auto-version a major release[\s\S]*breaking\/breaking-thing\.md/,
      );
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('an "ignored" bumpLevelSupport strategy lets an implicit breaking cut through silently', () => {
    const rootDir = makeStableFixtureRoot('0.14.0');
    try {
      writeStableFragment(rootDir, 'breaking', 'breaking-thing.md', 'Breaking change summary');
      const strategy: VersionStrategy = { ...makeLegacyPatchStrategy(), bumpLevelSupport: 'ignored' };
      const config = makeStableConfig(rootDir, strategy);

      expect(() => cutRelease(config, { date: '2026-07-16' })).not.toThrow();
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('an explicit version bypasses the refusal guard even without bumpLevelSupport', () => {
    const rootDir = makeStableFixtureRoot('0.14.0');
    try {
      writeStableFragment(rootDir, 'breaking', 'breaking-thing.md', 'Breaking change summary');
      const config = makeStableConfig(rootDir, makeLegacyPatchStrategy());

      expect(() => cutRelease(config, { version: '9.9.9', date: '2026-07-16' })).not.toThrow();
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});

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
