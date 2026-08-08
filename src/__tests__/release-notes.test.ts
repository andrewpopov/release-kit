// Ported from rouge's tests/release-notes.test.ts (node:test -> vitest),
// targeting the release-kit package API configured with rouge's exact
// values instead of requiring rouge's scripts directly.

import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { alphaSemver } from '../version';
import { publishRelease, bumpVersion, validateReleaseState } from '../publish';
import { renderReleaseNote } from '../render';
import { writeNewFragment, collectFragments } from '../fragments';
import { makeRougeConfig } from './fixtures/rougeConfig';

function makeFixtureRoot(version = '0.1.0-alpha.1'): string {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-kit-notes-'));
  fs.mkdirSync(path.join(rootDir, 'docs', 'patch-notes', 'unreleased'), { recursive: true });
  writePackageFiles(rootDir, version);
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
      {
        name: 'angel-snack',
        version,
        lockfileVersion: 3,
        packages: { '': { name: 'angel-snack', version } },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

function writeFragment(rootDir: string, fileName: string, kind: string, summary: string, body: string): void {
  fs.writeFileSync(
    path.join(rootDir, 'docs', 'patch-notes', 'unreleased', fileName),
    ['---', `kind: ${kind}`, `summary: ${summary}`, '---', '', body, ''].join('\n'),
    'utf8',
  );
}

function writePublishedRelease(
  rootDir: string,
  version: string,
  options: { titleVersion?: string; packageVersion?: string; stage?: string; linkInIndex?: boolean } = {},
): void {
  const releasesDir = path.join(rootDir, 'docs', 'patch-notes', 'releases');
  fs.mkdirSync(releasesDir, { recursive: true });
  const titleVersion = options.titleVersion ?? version;
  const packageVersion = options.packageVersion ?? version;
  const stage = options.stage ?? 'alpha';
  fs.writeFileSync(
    path.join(releasesDir, `${version}.md`),
    [
      `# Angel Snack ${titleVersion} Patch Notes`,
      '',
      'Release date: 2026-07-04',
      `Stage: ${stage}`,
      `Package version: ${packageVersion}`,
      '',
      '## Operations',
      '',
      '- **Release ritual:** Demo body.',
      '',
    ].join('\n'),
    'utf8',
  );
  const link = options.linkInIndex === false ? '' : `- [${version}](patch-notes/releases/${version}.md) - 2026-07-04\n`;
  fs.writeFileSync(
    path.join(rootDir, 'docs', 'PATCH_NOTES.md'),
    [
      '# Angel Snack Patch Notes',
      '',
      `Current game version: \`${version}\``,
      '',
      '<!-- patch-notes:start -->',
      '## Releases',
      '',
      link.trimEnd(),
      '<!-- patch-notes:end -->',
      '',
    ].join('\n'),
    'utf8',
  );
}

describe('release-notes (ported from rouge)', () => {
  test('alpha version validation requires prerelease alpha semver', () => {
    const strategy = alphaSemver({ versionLabel: 'Game version' });
    expect(() => strategy.assert('0.1.0-alpha.0')).not.toThrow();
    expect(() => strategy.assert('0.1.0')).toThrow(/must use alpha semver/);
  });

  test('release notes render fragments grouped by release kind', () => {
    const config = makeRougeConfig('/unused');
    const rendered = renderReleaseNote(config, {
      version: '0.1.0-alpha.2',
      date: '2026-07-04',
      commit: 'abc1234',
      fragments: [
        {
          filePath: '/unused/ops-patch-note-publishing.md',
          kind: 'ops',
          summary: 'Patch note publishing',
          body: 'Added a repeatable release-note flow.',
          fileName: 'ops-patch-note-publishing.md',
        },
        {
          filePath: '/unused/gameplay-town-pacing.md',
          kind: 'gameplay',
          summary: 'Town pacing',
          body: 'Improved the town handoff after combat.',
          fileName: 'gameplay-town-pacing.md',
        },
      ],
    });

    expect(rendered).toMatch(/^# Angel Snack 0\.1\.0-alpha\.2 Patch Notes/m);
    expect(rendered).toMatch(/^Release date: 2026-07-04/m);
    expect(rendered).toMatch(/^Commit: abc1234/m);
    expect(rendered.indexOf('## Gameplay')).toBeLessThan(rendered.indexOf('## Operations'));
    expect(rendered).toMatch(/\*\*Town pacing:\*\* Improved the town handoff after combat\./);
  });

  test('publishRelease writes a release, archives fragments, and refreshes the index', () => {
    const rootDir = makeFixtureRoot('0.1.0-alpha.3');
    try {
      writeFragment(
        rootDir,
        'ops-release-ritual.md',
        'ops',
        'Release ritual',
        'Documented the alpha release flow and patch-note fragment process.',
      );

      const config = makeRougeConfig(rootDir);
      const result = publishRelease(config, { date: '2026-07-04' });

      expect(result.version).toBe('0.1.0-alpha.3');
      expect(result.fragmentCount).toBe(1);
      expect(fs.existsSync(path.join(rootDir, 'docs', 'patch-notes', 'releases', '0.1.0-alpha.3.md'))).toBe(true);
      expect(
        fs.existsSync(path.join(rootDir, 'docs', 'patch-notes', 'archive', '0.1.0-alpha.3', 'ops-release-ritual.md')),
      ).toBe(true);
      expect(fs.existsSync(path.join(rootDir, 'docs', 'patch-notes', 'unreleased', 'ops-release-ritual.md'))).toBe(false);

      const indexSource = fs.readFileSync(path.join(rootDir, 'docs', 'PATCH_NOTES.md'), 'utf8');
      expect(indexSource).toMatch(/Current game version: `0\.1\.0-alpha\.3`/);
      expect(indexSource).toMatch(/\[0\.1\.0-alpha\.3\]\(patch-notes\/releases\/0\.1\.0-alpha\.3\.md\)/);

      const validation = validateReleaseState(config);
      expect(validation.errors).toEqual([]);
      expect(validation.ok).toBe(true);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('publishRelease omits commit unless explicitly supplied', () => {
    const rootDir = makeFixtureRoot('0.1.0-alpha.4');
    try {
      writeFragment(rootDir, 'ops-demo.md', 'ops', 'Demo', 'Demo body.');
      execFileSync('git', ['init', '-q'], { cwd: rootDir });
      execFileSync('git', ['config', 'user.email', 'review@example.com'], { cwd: rootDir });
      execFileSync('git', ['config', 'user.name', 'Review'], { cwd: rootDir });
      execFileSync('git', ['add', '.'], { cwd: rootDir });
      execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: rootDir });

      const config = makeRougeConfig(rootDir);
      const result = publishRelease(config, { date: '2026-07-04' });
      const source = fs.readFileSync(result.releasePath, 'utf8');
      expect(source).not.toMatch(/^Commit:/m);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('bumpVersion increments package and lockfile versions', () => {
    const rootDir = makeFixtureRoot('0.1.0-alpha.4');
    try {
      const config = makeRougeConfig(rootDir);
      const result = bumpVersion(config);
      expect(result).toEqual({ previousVersion: '0.1.0-alpha.4', version: '0.1.0-alpha.5' });

      const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')) as { version: string };
      const lock = JSON.parse(fs.readFileSync(path.join(rootDir, 'package-lock.json'), 'utf8')) as {
        version: string;
        packages: { '': { version: string } };
      };
      expect(pkg.version).toBe('0.1.0-alpha.5');
      expect(lock.version).toBe('0.1.0-alpha.5');
      expect(lock.packages[''].version).toBe('0.1.0-alpha.5');
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('writeNewFragment creates a fragment that parses once the placeholder body is replaced', () => {
    const rootDir = makeFixtureRoot();
    try {
      const config = makeRougeConfig(rootDir);
      const fragmentPath = writeNewFragment(config, { kind: 'ui', slug: 'settings-polish', summary: 'Settings polish' });

      expect(path.basename(fragmentPath)).toBe('ui-settings-polish.md');

      // A freshly scaffolded fragment still carries the placeholder body by
      // design (scaffold, then edit) — release-kit now refuses to publish it
      // as-is (PTRY-487), so collectFragments must reject the raw scaffold.
      expect(() => collectFragments(config)).toThrow(/ui-settings-polish\.md body is still the scaffold placeholder/);

      fs.writeFileSync(
        fragmentPath,
        fs.readFileSync(fragmentPath, 'utf8').replace(config.fragmentBodyPlaceholder, 'Polished the settings screen layout.'),
        'utf8',
      );

      const fragments = collectFragments(config);
      expect(fragments.length).toBe(1);
      expect(fragments[0].kind).toBe('ui');
      expect(fragments[0].summary).toBe('Settings polish');
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('validateReleaseState rejects non-alpha package versions', () => {
    const rootDir = makeFixtureRoot('0.1.0');
    try {
      const config = makeRougeConfig(rootDir);
      const validation = validateReleaseState(config);
      expect(validation.ok).toBe(false);
      expect(validation.errors.some((error) => error.includes('must use alpha semver'))).toBe(true);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('validateReleaseState catches stale lockfile and patch-note metadata drift', () => {
    const lockDriftRoot = makeFixtureRoot('0.1.0-alpha.5');
    const indexDriftRoot = makeFixtureRoot('0.1.0-alpha.6');
    const releaseDriftRoot = makeFixtureRoot('0.1.0-alpha.7');
    try {
      writePublishedRelease(lockDriftRoot, '0.1.0-alpha.5');
      writePackageFiles(lockDriftRoot, '0.1.0-alpha.4');
      fs.writeFileSync(
        path.join(lockDriftRoot, 'package.json'),
        `${JSON.stringify({ name: 'angel-snack', version: '0.1.0-alpha.5' }, null, 2)}\n`,
        'utf8',
      );
      const lockDrift = validateReleaseState(makeRougeConfig(lockDriftRoot));
      expect(lockDrift.ok).toBe(false);
      expect(lockDrift.errors.some((error) => error.includes('package-lock.json version 0.1.0-alpha.4'))).toBe(true);

      writePublishedRelease(indexDriftRoot, '0.1.0-alpha.6', { linkInIndex: false });
      const indexDrift = validateReleaseState(makeRougeConfig(indexDriftRoot));
      expect(indexDrift.ok).toBe(false);
      expect(
        indexDrift.errors.some((error) => error.includes('does not link to docs/patch-notes/releases/0.1.0-alpha.6.md')),
      ).toBe(true);

      writePublishedRelease(releaseDriftRoot, '0.1.0-alpha.7', { packageVersion: '0.1.0-alpha.6' });
      const releaseDrift = validateReleaseState(makeRougeConfig(releaseDriftRoot));
      expect(releaseDrift.ok).toBe(false);
      expect(
        releaseDrift.errors.some((error) => error.includes('package version 0.1.0-alpha.6 does not match 0.1.0-alpha.7')),
      ).toBe(true);
    } finally {
      fs.rmSync(lockDriftRoot, { recursive: true, force: true });
      fs.rmSync(indexDriftRoot, { recursive: true, force: true });
      fs.rmSync(releaseDriftRoot, { recursive: true, force: true });
    }
  });
});
