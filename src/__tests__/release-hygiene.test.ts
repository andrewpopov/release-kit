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

describe('release-hygiene (ported from rouge)', { timeout: 30_000 }, () => {
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

// The gate asymmetry this closes: `hygiene` (run in consumers' pre-push
// hooks) checked only that a patch-note fragment EXISTED, while `check`/
// `publish` additionally rejected a scaffold-placeholder body — so a
// placeholder fragment sailed through every push and only surfaced after a
// production deploy, at release time. hygiene now rejects a placeholder body
// too, but ONLY for fragments the current change adds or modifies: it must
// not retroactively fail a push over pre-existing placeholder debt elsewhere
// in the repo.
describe('release-hygiene placeholder-body ratchet', { timeout: 30_000 }, () => {
  function writeFragmentWithBody(rootDir: string, fileName: string, body: string): void {
    const notesDir = path.join(rootDir, 'docs', 'patch-notes', 'unreleased');
    fs.mkdirSync(notesDir, { recursive: true });
    fs.writeFileSync(path.join(notesDir, fileName), ['---', 'kind: ops', 'summary: Release hygiene', '---', '', body, ''].join('\n'), 'utf8');
  }

  test('a changed fragment with a placeholder body fails hygiene, naming the file', () => {
    const rootDir = makeGitRoot();
    try {
      const config = makeRougeConfig(rootDir);

      fs.mkdirSync(path.join(rootDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(rootDir, 'src', 'index.ts'), 'export {};\n', 'utf8');
      writeFragmentWithBody(rootDir, 'ops-release-hygiene.md', config.fragmentBodyPlaceholder);

      const result = checkReleaseHygiene(config, { baseRef: 'HEAD' });

      expect(result.ok).toBe(false);
      expect(result.placeholderPatchNoteFiles).toEqual(['docs/patch-notes/unreleased/ops-release-hygiene.md']);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('a changed fragment with a real body passes hygiene', () => {
    const rootDir = makeGitRoot();
    try {
      const config = makeRougeConfig(rootDir);

      fs.mkdirSync(path.join(rootDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(rootDir, 'src', 'index.ts'), 'export {};\n', 'utf8');
      writeFragmentWithBody(rootDir, 'ops-release-hygiene.md', 'Added release hygiene coverage for agent-authored changes.');

      const result = checkReleaseHygiene(config, { baseRef: 'HEAD' });

      expect(result.ok).toBe(true);
      expect(result.placeholderPatchNoteFiles).toEqual([]);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('a pre-existing (unchanged) placeholder fragment does not fail hygiene — the ratchet', () => {
    const rootDir = makeGitRoot();
    try {
      const config = makeRougeConfig(rootDir);

      // Committed to the base branch already — nobody touched it in this change.
      writeFragmentWithBody(rootDir, 'ops-old-debt.md', config.fragmentBodyPlaceholder);
      git(rootDir, ['add', '.']);
      git(rootDir, ['commit', '-q', '-m', 'pre-existing placeholder debt']);

      // This change only touches src/ plus its OWN, properly-written fragment.
      fs.mkdirSync(path.join(rootDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(rootDir, 'src', 'index.ts'), 'export {};\n', 'utf8');
      writeFragmentWithBody(rootDir, 'ops-release-hygiene.md', 'Added release hygiene coverage for agent-authored changes.');

      const result = checkReleaseHygiene(config, { baseRef: 'HEAD' });

      expect(result.ok).toBe(true);
      expect(result.placeholderPatchNoteFiles).toEqual([]);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('a deleted fragment is not validated for a placeholder body', () => {
    const rootDir = makeGitRoot();
    try {
      const config = makeRougeConfig(rootDir);

      writeFragmentWithBody(rootDir, 'ops-retired.md', config.fragmentBodyPlaceholder);
      git(rootDir, ['add', '.']);
      git(rootDir, ['commit', '-q', '-m', 'add a placeholder fragment to remove']);

      fs.rmSync(path.join(rootDir, 'docs', 'patch-notes', 'unreleased', 'ops-retired.md'));

      const result = checkReleaseHygiene(config, { baseRef: 'HEAD' });

      expect(result.patchNoteFiles).toEqual(['docs/patch-notes/unreleased/ops-retired.md']);
      expect(result.placeholderPatchNoteFiles).toEqual([]);
      expect(result.ok).toBe(true);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});

// PTRY-526: hygiene checked that a fragment existed and had a written body,
// but never that its summary was renderable. `parseFragment` (used by
// `check`/`publish`) has always rejected a summary ending in '.' — the
// renderer emits `**{summary}:**`, so a trailing period renders
// `**Summary.:**` — but hygiene never applied that rule, so a trailing-period
// summary sailed through every push and only surfaced at check/publish time,
// after a production deploy. hygiene now rejects it too, scoped to only the
// fragments the current change adds or modifies, via the same
// `validateFragmentContent` helper `parseFragment` uses, so the two paths
// cannot drift apart the way they just did for the placeholder-body rule.
describe('release-hygiene summary trailing-period ratchet', { timeout: 30_000 }, () => {
  function writeFragmentWithSummary(rootDir: string, fileName: string, summary: string): void {
    const notesDir = path.join(rootDir, 'docs', 'patch-notes', 'unreleased');
    fs.mkdirSync(notesDir, { recursive: true });
    fs.writeFileSync(
      path.join(notesDir, fileName),
      ['---', 'kind: ops', `summary: ${summary}`, '---', '', 'A real impact paragraph.', ''].join('\n'),
      'utf8',
    );
  }

  test('a changed fragment with a trailing-period summary fails hygiene, naming the file', () => {
    const rootDir = makeGitRoot();
    try {
      const config = makeRougeConfig(rootDir);

      fs.mkdirSync(path.join(rootDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(rootDir, 'src', 'index.ts'), 'export {};\n', 'utf8');
      writeFragmentWithSummary(rootDir, 'ops-release-hygiene.md', 'Release hygiene summary.');

      const result = checkReleaseHygiene(config, { baseRef: 'HEAD' });

      expect(result.ok).toBe(false);
      expect(result.trailingPeriodSummaryPatchNoteFiles).toEqual(['docs/patch-notes/unreleased/ops-release-hygiene.md']);
      expect(result.placeholderPatchNoteFiles).toEqual([]);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('a changed fragment with a clean summary passes hygiene', () => {
    const rootDir = makeGitRoot();
    try {
      const config = makeRougeConfig(rootDir);

      fs.mkdirSync(path.join(rootDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(rootDir, 'src', 'index.ts'), 'export {};\n', 'utf8');
      writeFragmentWithSummary(rootDir, 'ops-release-hygiene.md', 'Release hygiene summary');

      const result = checkReleaseHygiene(config, { baseRef: 'HEAD' });

      expect(result.ok).toBe(true);
      expect(result.trailingPeriodSummaryPatchNoteFiles).toEqual([]);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('a pre-existing (unchanged) trailing-period fragment does not fail hygiene — the ratchet', () => {
    const rootDir = makeGitRoot();
    try {
      const config = makeRougeConfig(rootDir);

      // Committed to the base branch already — nobody touched it in this change.
      writeFragmentWithSummary(rootDir, 'ops-old-debt.md', 'Old debt summary.');
      git(rootDir, ['add', '.']);
      git(rootDir, ['commit', '-q', '-m', 'pre-existing trailing-period debt']);

      // This change only touches src/ plus its OWN, properly-written fragment.
      fs.mkdirSync(path.join(rootDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(rootDir, 'src', 'index.ts'), 'export {};\n', 'utf8');
      writeFragmentWithSummary(rootDir, 'ops-release-hygiene.md', 'Release hygiene summary');

      const result = checkReleaseHygiene(config, { baseRef: 'HEAD' });

      expect(result.ok).toBe(true);
      expect(result.trailingPeriodSummaryPatchNoteFiles).toEqual([]);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('a deleted fragment is not validated for a trailing-period summary', () => {
    const rootDir = makeGitRoot();
    try {
      const config = makeRougeConfig(rootDir);

      writeFragmentWithSummary(rootDir, 'ops-retired.md', 'Retired summary.');
      git(rootDir, ['add', '.']);
      git(rootDir, ['commit', '-q', '-m', 'add a trailing-period fragment to remove']);

      fs.rmSync(path.join(rootDir, 'docs', 'patch-notes', 'unreleased', 'ops-retired.md'));

      const result = checkReleaseHygiene(config, { baseRef: 'HEAD' });

      expect(result.patchNoteFiles).toEqual(['docs/patch-notes/unreleased/ops-retired.md']);
      expect(result.trailingPeriodSummaryPatchNoteFiles).toEqual([]);
      expect(result.ok).toBe(true);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});

// PTRY-524: `isReleaseRelevantFile` matches on broad prefixes
// (`relevantPrefixes`/`relevantScriptPrefixes`), and test files live under
// those same prefixes (`src/**/__tests__/**`, `*.test.ts`, `*.spec.tsx`), so
// a change that adds ONLY tests was classified release-relevant and blocked
// at push time for a change no user can observe. `excludePatterns` (default:
// test-file shapes) exempts a genuinely test-only change without weakening
// the gate for a change that also touches real source under the same prefix.
describe('release-hygiene test-only exclude patterns', () => {
  test('a test-only change under a relevant prefix does not require a patch note', () => {
    const config = makeRougeConfig('/unused');
    const result = classifyReleaseHygiene(config, [
      'src/combat/__tests__/combat-engine.test.ts',
      'src/ui/town-view.spec.tsx',
      'src/ui/__mocks__/town-view.ts',
    ]);
    expect(result.ok).toBe(true);
    expect(result.requiresPatchNote).toBe(false);
    expect(result.relevantFiles).toEqual([]);
  });

  test('a change touching real source AND tests under the same prefix still requires a patch note', () => {
    const config = makeRougeConfig('/unused');
    const result = classifyReleaseHygiene(config, [
      'src/combat/combat-engine.ts',
      'src/combat/__tests__/combat-engine.test.ts',
    ]);
    expect(result.ok).toBe(false);
    expect(result.requiresPatchNote).toBe(true);
    expect(result.relevantFiles).toEqual(['src/combat/combat-engine.ts']);
  });

  test('an excluded test path does not satisfy patch-note coverage on its own (fails, not silently exempted)', () => {
    const config = makeRougeConfig('/unused');
    const result = classifyReleaseHygiene(config, [
      'src/combat/combat-engine.ts',
      'src/combat/__tests__/combat-engine.test.ts',
      'docs/patch-notes/unreleased/gameplay-combat-pacing.md',
    ]);
    expect(result.ok).toBe(true);
    expect(result.relevantFiles).toEqual(['src/combat/combat-engine.ts']);
  });

  test('exact relevantFiles/relevantDocFiles entries are never excluded, even if they look like a test file', () => {
    const config = {
      ...makeRougeConfig('/unused'),
      hygiene: {
        ...makeRougeConfig('/unused').hygiene,
        relevantFiles: ['scripts/build.test.js'],
      },
    };
    const result = classifyReleaseHygiene(config, ['scripts/build.test.js']);
    expect(result.ok).toBe(false);
    expect(result.relevantFiles).toEqual(['scripts/build.test.js']);
  });

  test('a repo can override excludePatterns to disable the default test exemption', () => {
    const config = {
      ...makeRougeConfig('/unused'),
      hygiene: {
        ...makeRougeConfig('/unused').hygiene,
        excludePatterns: [],
      },
    };
    const result = classifyReleaseHygiene(config, ['src/combat/__tests__/combat-engine.test.ts']);
    expect(result.ok).toBe(false);
    expect(result.relevantFiles).toEqual(['src/combat/__tests__/combat-engine.test.ts']);
  });
});
