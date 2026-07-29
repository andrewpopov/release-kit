// Ported from rouge's tests/release-hygiene.test.ts (node:test -> vitest).

import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { classifyReleaseHygiene, checkReleaseHygiene, isPatchNoteArtifact } from '../hygiene';
import { makeRougeConfig } from './fixtures/rougeConfig';
import { cutRelease } from '../publish';
import { changelogTarget } from '../notes-target';
import { stableSemver } from '../version';
import { npmPackage } from '../manifest';
import type { ReleaseKitConfig } from '../config';

function makeGitRoot(): string {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-kit-hygiene-'));
  fs.writeFileSync(path.join(rootDir, 'README.md'), '# Fixture\n', 'utf8');
  git(rootDir, ['init', '-q']);
  git(rootDir, ['config', 'user.email', 'review@example.com']);
  git(rootDir, ['config', 'user.name', 'Review']);
  git(rootDir, ['add', '.']);
  git(rootDir, ['commit', '-q', '-m', 'initial']);
  return rootDir;
}

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

/** A minimal `changelogTarget()` config for the post-cut end-to-end test below. */
function makeStableChangelogConfig(rootDir: string): ReleaseKitConfig {
  return {
    productName: 'Stable App',
    stage: 'stable',
    rootDir,
    paths: { notesDir: 'docs/patch-notes', indexPath: 'docs/PATCH_NOTES.md' },
    kinds: [{ id: 'fixed', heading: 'Fixed' }],
    versionStrategy: stableSemver(),
    manifest: npmPackage(),
    hygiene: {
      baseRef: 'HEAD',
      relevantPrefixes: ['src/'],
      relevantFiles: ['package.json'],
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

function writeFragment(rootDir: string): void {
  const notesDir = path.join(rootDir, 'docs', 'patch-notes', 'unreleased');
  fs.mkdirSync(notesDir, { recursive: true });
  fs.writeFileSync(
    path.join(notesDir, 'ops-release-hygiene.md'),
    ['---', 'kind: ops', 'summary: Release hygiene', '---', '', 'Added release hygiene coverage for agent-authored changes.', ''].join(
      '\n',
    ),
    'utf8',
  );
}

describe('release-hygiene (ported from rouge)', () => {
  test('docs and tests only do not require a patch-note fragment', () => {
    const config = makeRougeConfig('/unused');
    const result = classifyReleaseHygiene(config, ['docs/GAME_GUIDE.md', 'tests/combat-flow.test.ts']);
    expect(result.ok).toBe(true);
    expect(result.requiresPatchNote).toBe(false);
    expect(result.relevantFiles).toEqual([]);
  });

  test('runtime changes require a patch-note artifact', () => {
    const config = makeRougeConfig('/unused');
    const result = classifyReleaseHygiene(config, ['src/ui/town-view.ts']);
    expect(result.ok).toBe(false);
    expect(result.requiresPatchNote).toBe(true);
    expect(result.relevantFiles).toEqual(['src/ui/town-view.ts']);
  });

  test('unreleased fragments satisfy release-relevant feature changes', () => {
    const config = makeRougeConfig('/unused');
    const result = classifyReleaseHygiene(config, [
      'src/combat/combat-engine.ts',
      'docs/patch-notes/unreleased/gameplay-combat-pacing.md',
    ]);
    expect(result.ok).toBe(true);
    expect(result.patchNoteFiles).toEqual(['docs/patch-notes/unreleased/gameplay-combat-pacing.md']);
  });

  test('published release notes satisfy release branches after publish', () => {
    const config = makeRougeConfig('/unused');
    const result = classifyReleaseHygiene(config, [
      'package.json',
      'package-lock.json',
      'docs/patch-notes/releases/0.1.0-alpha.1.md',
      'docs/PATCH_NOTES.md',
    ]);
    expect(result.ok).toBe(true);
    expect(result.patchNoteFiles).toEqual(['docs/patch-notes/releases/0.1.0-alpha.1.md']);
  });

  test('archived fragments satisfy release branches (a cut relocates unreleased/ fragments to archive/<version>/)', () => {
    const config = makeRougeConfig('/unused');
    const result = classifyReleaseHygiene(config, [
      'package.json',
      'docs/patch-notes/archive/0.1.0-alpha.1/gameplay-combat-pacing.md',
    ]);
    expect(result.ok).toBe(true);
    expect(result.patchNoteFiles).toEqual(['docs/patch-notes/archive/0.1.0-alpha.1/gameplay-combat-pacing.md']);
  });

  test('a release-relevant change with no fragment anywhere (unreleased, releases, or archive) still fails', () => {
    const config = makeRougeConfig('/unused');
    const result = classifyReleaseHygiene(config, ['src/ui/town-view.ts']);
    expect(result.ok).toBe(false);
    expect(result.patchNoteFiles).toEqual([]);
  });

  test('README.md and files starting with `_` under archive/ are not fragments', () => {
    const config = makeRougeConfig('/unused');
    expect(isPatchNoteArtifact(config, 'docs/patch-notes/archive/0.1.0-alpha.1/README.md')).toBe(false);
    expect(isPatchNoteArtifact(config, 'docs/patch-notes/archive/0.1.0-alpha.1/_internal.md')).toBe(false);
  });

  test('release tooling and deploy behavior are release-relevant', () => {
    const config = makeRougeConfig('/unused');
    const result = classifyReleaseHygiene(config, [
      'scripts/cut-release.js',
      'scripts/deploy.sh',
      'scripts/lib/patch-notes-site.js',
      'scripts/lib/release-notes-core.js',
      'docs/ops/RELEASE_ASSISTANT_PLAN.md',
      'docs/ops/RELEASE_PROCESS.md',
    ]);
    expect(result.ok).toBe(false);
    expect(result.relevantFiles).toEqual([
      'docs/ops/RELEASE_ASSISTANT_PLAN.md',
      'docs/ops/RELEASE_PROCESS.md',
      'scripts/cut-release.js',
      'scripts/deploy.sh',
      'scripts/lib/patch-notes-site.js',
      'scripts/lib/release-notes-core.js',
    ]);
  });

  test('fragment README and private underscore files do not satisfy coverage', () => {
    const config = makeRougeConfig('/unused');
    expect(isPatchNoteArtifact(config, 'docs/patch-notes/unreleased/README.md')).toBe(false);
    expect(isPatchNoteArtifact(config, 'docs/patch-notes/unreleased/_internal.md')).toBe(false);

    const result = classifyReleaseHygiene(config, [
      'src/app/app-controller.ts',
      'docs/patch-notes/unreleased/README.md',
      'docs/patch-notes/unreleased/_internal.md',
    ]);
    expect(result.ok).toBe(false);
    expect(result.patchNoteFiles).toEqual([]);
  });

  test('git collector sees untracked runtime files and untracked fragments', () => {
    const rootDir = makeGitRoot();
    try {
      fs.mkdirSync(path.join(rootDir, 'src', 'ui'), { recursive: true });
      fs.writeFileSync(path.join(rootDir, 'src', 'ui', 'demo.ts'), 'export {};\n', 'utf8');

      const config = makeRougeConfig(rootDir);
      const missingFragment = checkReleaseHygiene(config, { baseRef: 'HEAD' });
      expect(missingFragment.ok).toBe(false);
      expect(missingFragment.relevantFiles).toEqual(['src/ui/demo.ts']);

      writeFragment(rootDir);
      const withFragment = checkReleaseHygiene(config, { baseRef: 'HEAD' });
      expect(withFragment.ok).toBe(true);
      expect(withFragment.patchNoteFiles).toEqual(['docs/patch-notes/unreleased/ops-release-hygiene.md']);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  // Reproduces the real bug: auth-kit's first release branch (src/ change +
  // `release:cut` against `changelogTarget()`) reported "release-relevant
  // changes need a patch-note artifact" and failed hygiene, because the cut
  // moves the fragment out of unreleased/ into archive/<version>/ and
  // isPatchNoteArtifact only recognized unreleased/ and releases/.
  test('a branch that changed src/ and cut a release passes hygiene post-cut', () => {
    const rootDir = makeGitRoot();
    try {
      fs.mkdirSync(path.join(rootDir, 'docs', 'patch-notes', 'unreleased'), { recursive: true });
      fs.writeFileSync(path.join(rootDir, 'package.json'), `${JSON.stringify({ name: 'stable-app', version: '0.14.0' }, null, 2)}\n`, 'utf8');
      fs.writeFileSync(path.join(rootDir, 'CHANGELOG.md'), '# Changelog\n', 'utf8');
      git(rootDir, ['add', '.']);
      git(rootDir, ['commit', '-q', '-m', 'baseline']);

      const config = makeStableChangelogConfig(rootDir);

      // Branch work: a src/ change plus its patch-note fragment.
      fs.mkdirSync(path.join(rootDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(rootDir, 'src', 'index.ts'), 'export {};\n', 'utf8');
      fs.writeFileSync(
        path.join(rootDir, 'docs', 'patch-notes', 'unreleased', 'fixed-thing.md'),
        ['---', 'kind: fixed', 'summary: Fixed a thing', '---', '', 'Body text.', ''].join('\n'),
        'utf8',
      );
      expect(checkReleaseHygiene(config, { baseRef: 'HEAD' }).ok).toBe(true);

      cutRelease(config, { date: '2026-07-16' });

      const unreleasedDir = path.join(rootDir, 'docs', 'patch-notes', 'unreleased');
      expect(fs.readdirSync(unreleasedDir)).toEqual([]);
      expect(fs.existsSync(path.join(rootDir, 'docs', 'patch-notes', 'archive', '0.14.1', 'fixed-thing.md'))).toBe(true);
      expect(fs.readFileSync(path.join(rootDir, 'CHANGELOG.md'), 'utf8')).toContain('## 0.14.1');

      const postCut = checkReleaseHygiene(config, { baseRef: 'HEAD' });
      expect(postCut.ok).toBe(true);
      expect(postCut.patchNoteFiles).toEqual(['docs/patch-notes/archive/0.14.1/fixed-thing.md']);
      expect(postCut.relevantFiles).toEqual(['package.json', 'src/index.ts']);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
