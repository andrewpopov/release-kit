// Covers the new `changelogTarget` notes-target: a flat CHANGELOG.md with
// `## X.Y.Z` version sections, the invariant a fleet `release-guard` checks
// with `^## <version>`. Fixture style ported from release-cut.test.ts.

import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ReleaseKitConfig } from '../config';
import { changelogTarget, type ChangelogTargetOptions } from '../notes-target';
import { collectFragments } from '../fragments';
import { cutRelease, validateReleaseState } from '../publish';
import { makeRougeConfig } from './fixtures/rougeConfig';

function makeFixtureRoot(version = '0.1.0-alpha.0'): string {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-kit-changelog-'));
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
      { name: 'angel-snack', version, lockfileVersion: 3, packages: { '': { name: 'angel-snack', version } } },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

function writeFragment(rootDir: string, kind: string, slug: string, summary: string, body: string): void {
  fs.writeFileSync(
    path.join(rootDir, 'docs', 'patch-notes', 'unreleased', `${kind}-${slug}.md`),
    ['---', `kind: ${kind}`, `summary: ${summary}`, '---', '', body, ''].join('\n'),
    'utf8',
  );
}

function configWithChangelog(rootDir: string, options?: ChangelogTargetOptions): ReleaseKitConfig {
  return { ...makeRougeConfig(rootDir), notesTarget: changelogTarget(options) };
}

describe('changelogTarget', () => {
  test('publish creates CHANGELOG.md with a title and version section when missing', () => {
    const rootDir = makeFixtureRoot();
    try {
      writeFragment(rootDir, 'fix', 'a', 'Fixed a bug', 'Detailed fix body.');
      const config = configWithChangelog(rootDir);
      const fragments = collectFragments(config);
      const changelogPath = path.join(rootDir, 'CHANGELOG.md');
      expect(fs.existsSync(changelogPath)).toBe(false);

      const result = changelogTarget().publish(
        config,
        { version: '0.1.0-alpha.1', date: '2026-07-05', commit: 'abc123', fragments },
        {},
      );

      expect(result.releasePath).toBe(changelogPath);
      const content = fs.readFileSync(changelogPath, 'utf8');
      expect(content.startsWith('# Changelog')).toBe(true);
      expect(content).toMatch(/^## 0\.1\.0-alpha\.1 *$/m);
      expect(content).toContain('- Fixed a bug');
      expect(content).toContain('  Detailed fix body.');
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('publish prepends the new version above an older version and below a non-version preamble', () => {
    const rootDir = makeFixtureRoot();
    try {
      const changelogPath = path.join(rootDir, 'CHANGELOG.md');
      fs.writeFileSync(
        changelogPath,
        [
          '# Changelog',
          '',
          '## Unreleased Notes',
          '',
          'Some preamble doc text that is not a version section.',
          '',
          '## 0.1.0-alpha.0',
          '',
          '- Initial release.',
          '',
        ].join('\n'),
        'utf8',
      );
      writeFragment(rootDir, 'fix', 'a', 'Fixed a bug', 'Detailed fix body.');
      const config = configWithChangelog(rootDir);
      const fragments = collectFragments(config);

      changelogTarget().publish(config, { version: '0.1.0-alpha.1', date: '2026-07-05', commit: '', fragments }, {});

      const content = fs.readFileSync(changelogPath, 'utf8');
      const preambleIndex = content.indexOf('## Unreleased Notes');
      const newVersionIndex = content.indexOf('## 0.1.0-alpha.1');
      const olderVersionIndex = content.indexOf('## 0.1.0-alpha.0');
      expect(preambleIndex).toBeGreaterThanOrEqual(0);
      expect(newVersionIndex).toBeGreaterThan(preambleIndex);
      expect(olderVersionIndex).toBeGreaterThan(newVersionIndex);
      // The preamble section's own content survives untouched.
      expect(content).toContain('Some preamble doc text that is not a version section.');
      expect(content).toContain('- Initial release.');
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('bullets appear in config.kinds order, not fragment-file alphabetical order', () => {
    const rootDir = makeFixtureRoot();
    try {
      // config.kinds order (rougeConfig): ... gameplay(1) ... fix(5) ... ops(7).
      // Filenames are deliberately alphabetical in the OPPOSITE order
      // (fix < gameplay < ops) so a passing test proves kind-order sorting,
      // not an accidental filename sort.
      writeFragment(rootDir, 'fix', 'a', 'Fix summary', 'Fix body.');
      writeFragment(rootDir, 'gameplay', 'b', 'Gameplay summary', 'Gameplay body.');
      writeFragment(rootDir, 'ops', 'c', 'Ops summary', 'Ops body.');
      const config = configWithChangelog(rootDir);
      const fragments = collectFragments(config);

      const result = changelogTarget().publish(
        config,
        { version: '0.1.0-alpha.1', date: '2026-07-05', commit: '', fragments },
        {},
      );

      const content = fs.readFileSync(result.releasePath, 'utf8');
      const gameplayIdx = content.indexOf('Gameplay summary');
      const fixIdx = content.indexOf('Fix summary');
      const opsIdx = content.indexOf('Ops summary');
      expect(gameplayIdx).toBeGreaterThan(-1);
      expect(gameplayIdx).toBeLessThan(fixIdx);
      expect(fixIdx).toBeLessThan(opsIdx);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('groupByKind emits ### kind-heading subsections, skipping empty kinds', () => {
    const rootDir = makeFixtureRoot();
    try {
      writeFragment(rootDir, 'fix', 'a', 'Fix summary', 'Fix body.');
      writeFragment(rootDir, 'gameplay', 'b', 'Gameplay summary', 'Gameplay body.');
      const config = configWithChangelog(rootDir, { groupByKind: true });
      const fragments = collectFragments(config);

      const result = config.notesTarget!.publish(
        config,
        { version: '0.1.0-alpha.1', date: '2026-07-05', commit: '', fragments },
        {},
      );

      const content = fs.readFileSync(result.releasePath, 'utf8');
      expect(content).toContain('### Gameplay');
      expect(content).toContain('### Fixes');
      expect(content.indexOf('### Gameplay')).toBeLessThan(content.indexOf('### Fixes'));
      // Kinds with no fragments (e.g. Highlights) get no empty subsection.
      expect(content).not.toContain('### Highlights');
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('publish consumes fragments: deletes from unreleased and archives them', () => {
    const rootDir = makeFixtureRoot();
    try {
      writeFragment(rootDir, 'fix', 'a', 'Fix summary', 'Fix body.');
      const config = configWithChangelog(rootDir);
      const fragments = collectFragments(config);
      const fragmentPath = fragments[0].filePath;
      expect(fs.existsSync(fragmentPath)).toBe(true);

      changelogTarget().publish(config, { version: '0.1.0-alpha.1', date: '2026-07-05', commit: '', fragments }, {});

      expect(fs.existsSync(fragmentPath)).toBe(false);
      expect(
        fs.existsSync(path.join(rootDir, 'docs', 'patch-notes', 'archive', '0.1.0-alpha.1', 'fix-a.md')),
      ).toBe(true);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('publish without force throws when the version section exists; force replaces it', () => {
    const rootDir = makeFixtureRoot();
    try {
      writeFragment(rootDir, 'fix', 'a', 'First summary', 'First body.');
      const config = configWithChangelog(rootDir);
      const target = changelogTarget();
      const fragments1 = collectFragments(config);
      target.publish(config, { version: '0.1.0-alpha.1', date: '2026-07-05', commit: '', fragments: fragments1 }, {});

      writeFragment(rootDir, 'fix', 'b', 'Second summary', 'Second body.');
      const fragments2 = collectFragments(config);
      expect(() =>
        target.publish(config, { version: '0.1.0-alpha.1', date: '2026-07-06', commit: '', fragments: fragments2 }, {}),
      ).toThrow(/CHANGELOG already has a ## 0\.1\.0-alpha\.1 section; re-run with force to overwrite\./);

      target.publish(
        config,
        { version: '0.1.0-alpha.1', date: '2026-07-06', commit: '', fragments: fragments2 },
        { force: true },
      );
      const content = fs.readFileSync(path.join(rootDir, 'CHANGELOG.md'), 'utf8');
      expect(content).not.toContain('First summary');
      expect(content).toContain('Second summary');
      expect(content.match(/^## 0\.1\.0-alpha\.1 *$/gm)?.length).toBe(1);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('validate returns [] when the version heading is present and an error when absent', () => {
    const rootDir = makeFixtureRoot();
    try {
      const config = configWithChangelog(rootDir);
      const target = changelogTarget();
      expect(target.validate(config, '0.1.0-alpha.1').length).toBeGreaterThan(0);

      writeFragment(rootDir, 'fix', 'a', 'Fix summary', 'Fix body.');
      const fragments = collectFragments(config);
      target.publish(config, { version: '0.1.0-alpha.1', date: '2026-07-05', commit: '', fragments }, {});

      expect(target.validate(config, '0.1.0-alpha.1')).toEqual([]);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('cutRelease with a changelogTarget bumps the manifest and writes a release-guard-matching heading', () => {
    const rootDir = makeFixtureRoot();
    try {
      writeFragment(rootDir, 'fix', 'a', 'Fix summary', 'Fix body.');
      const config = configWithChangelog(rootDir);

      const result = cutRelease(config, { date: '2026-07-05', commit: 'abc1234' });

      expect(result.version).toBe('0.1.0-alpha.1');
      const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')) as { version: string };
      expect(pkg.version).toBe('0.1.0-alpha.1');

      const content = fs.readFileSync(path.join(rootDir, 'CHANGELOG.md'), 'utf8');
      // Simulates the fleet's release-guard: `grep -E '^## <version>' CHANGELOG.md`.
      const releaseGuardRe = /^## 0\.1\.0-alpha\.1\b/m;
      expect(releaseGuardRe.test(content)).toBe(true);
      expect(validateReleaseState(config).ok).toBe(true);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('cutRelease without force throws for an already-cut version and leaves package.json unchanged; force succeeds', () => {
    const rootDir = makeFixtureRoot();
    try {
      const config = configWithChangelog(rootDir);

      writeFragment(rootDir, 'fix', 'a', 'First summary', 'First body.');
      const first = cutRelease(config, { date: '2026-07-05', commit: 'abc1234' });
      expect(first.version).toBe('0.1.0-alpha.1');

      writeFragment(rootDir, 'fix', 'b', 'Second summary', 'Second body.');
      const second = cutRelease(config, { date: '2026-07-06', commit: 'def5678' });
      expect(second.version).toBe('0.1.0-alpha.2');
      expect(
        JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')).version,
      ).toBe('0.1.0-alpha.2');

      // Re-cutting the already-published 0.1.0-alpha.1 (an older version than
      // the manifest's current 0.1.0-alpha.2) without force must throw BEFORE
      // bumpVersion runs, so package.json stays at 0.1.0-alpha.2 — not
      // partially bumped to 0.1.0-alpha.1 and then left there by the throw.
      writeFragment(rootDir, 'fix', 'c', 'Third summary', 'Third body.');
      expect(() =>
        cutRelease(config, { version: '0.1.0-alpha.1', date: '2026-07-07', commit: 'ghi9012' }),
      ).toThrow(/Release notes for 0\.1\.0-alpha\.1 already exist\. Re-run with force to overwrite\./);
      expect(
        JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')).version,
      ).toBe('0.1.0-alpha.2');

      const result = cutRelease(config, {
        version: '0.1.0-alpha.1',
        date: '2026-07-07',
        commit: 'ghi9012',
        force: true,
      });
      expect(result.version).toBe('0.1.0-alpha.1');
      expect(
        JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')).version,
      ).toBe('0.1.0-alpha.1');
      const content = fs.readFileSync(path.join(rootDir, 'CHANGELOG.md'), 'utf8');
      expect(content).toContain('Third summary');
      expect(content.match(/^## 0\.1\.0-alpha\.1 *$/gm)?.length).toBe(1);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('publish splices in the new section without disturbing an older section internal whitespace', () => {
    const rootDir = makeFixtureRoot();
    try {
      const changelogPath = path.join(rootDir, 'CHANGELOG.md');
      // The older section deliberately has TWO consecutive blank lines
      // between its bullets — an intentional byte sequence that a global
      // `replace(/\n{3,}/g, ...)` over the whole file would collapse.
      const olderSectionTail = '- Initial release.\n\n\n- Weird spacing bullet.';
      fs.writeFileSync(
        changelogPath,
        ['# Changelog', '', '## 0.1.0-alpha.0', '', olderSectionTail, ''].join('\n'),
        'utf8',
      );
      expect(fs.readFileSync(changelogPath, 'utf8')).toContain(olderSectionTail);

      writeFragment(rootDir, 'fix', 'a', 'New fix summary', 'New fix body.');
      const config = configWithChangelog(rootDir);
      const fragments = collectFragments(config);

      changelogTarget().publish(config, { version: '0.1.0-alpha.1', date: '2026-07-05', commit: '', fragments }, {});

      const content = fs.readFileSync(changelogPath, 'utf8');
      // The older section's exact bytes survive untouched...
      expect(content).toContain(olderSectionTail);
      // ...while the new section was added above it.
      expect(content.indexOf('## 0.1.0-alpha.1')).toBeLessThan(content.indexOf('## 0.1.0-alpha.0'));
      expect(content).toContain('New fix summary');
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('publish is not fooled by a decoy digit-led heading above the first real version section', () => {
    const rootDir = makeFixtureRoot();
    try {
      const changelogPath = path.join(rootDir, 'CHANGELOG.md');
      fs.writeFileSync(
        changelogPath,
        [
          '# Changelog',
          '',
          '## 1.2.3 notes',
          '',
          'Some roadmap notes that look like a version heading but are not one.',
          '',
          '## 0.1.0-alpha.0',
          '',
          '- Initial release.',
          '',
        ].join('\n'),
        'utf8',
      );
      writeFragment(rootDir, 'fix', 'a', 'New fix summary', 'New fix body.');
      const config = configWithChangelog(rootDir);
      const fragments = collectFragments(config);

      changelogTarget().publish(config, { version: '0.1.0-alpha.1', date: '2026-07-05', commit: '', fragments }, {});

      const content = fs.readFileSync(changelogPath, 'utf8');
      const decoyIndex = content.indexOf('## 1.2.3 notes');
      const newVersionIndex = content.indexOf('## 0.1.0-alpha.1');
      const realVersionIndex = content.indexOf('## 0.1.0-alpha.0');
      expect(decoyIndex).toBeGreaterThanOrEqual(0);
      // The new section must land right before the real version heading —
      // NOT before the decoy — i.e. after the decoy's own text.
      expect(newVersionIndex).toBeGreaterThan(decoyIndex);
      expect(newVersionIndex).toBeLessThan(realVersionIndex);
      expect(content).toContain('Some roadmap notes that look like a version heading but are not one.');
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('the default target (no notesTarget) still writes docs/patch-notes/releases/<version>.md', () => {
    const rootDir = makeFixtureRoot();
    try {
      writeFragment(rootDir, 'fix', 'a', 'Fix summary', 'Fix body.');
      const config = makeRougeConfig(rootDir); // no notesTarget set: the seam must default cleanly.

      const result = cutRelease(config, { date: '2026-07-05', commit: 'abc1234' });

      expect(
        fs.existsSync(path.join(rootDir, 'docs', 'patch-notes', 'releases', `${result.version}.md`)),
      ).toBe(true);
      expect(fs.existsSync(path.join(rootDir, 'CHANGELOG.md'))).toBe(false);
      expect(validateReleaseState(config).ok).toBe(true);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
