// PTRY-487: `release-kit check` validated a fragment's kind and summary but
// never its body, so a fragment left with the `note`-scaffolded placeholder
// body passed validation and published verbatim. Covers the placeholder-body
// guard and the related summary-trailing-period guard (render.ts emits
// `**{summary}:**`, so a summary ending in '.' renders `**Summary.:**`).

import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectFragments, writeNewFragment } from '../fragments';
import { cutRelease, validateReleaseState } from '../publish';
import { classifyReleaseHygiene } from '../hygiene';
import { makeRougeConfig } from './fixtures/rougeConfig';
import type { ReleaseKitConfig } from '../config';

function makeFixtureRoot(version = '0.1.0-alpha.1'): { rootDir: string; config: ReleaseKitConfig } {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-kit-placeholder-'));
  fs.mkdirSync(path.join(rootDir, 'docs', 'patch-notes', 'unreleased'), { recursive: true });
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
  return { rootDir, config: makeRougeConfig(rootDir) };
}

function writeFragment(rootDir: string, fileName: string, kind: string, summary: string, body: string): void {
  fs.writeFileSync(
    path.join(rootDir, 'docs', 'patch-notes', 'unreleased', fileName),
    ['---', `kind: ${kind}`, `summary: ${summary}`, '---', '', body, ''].join('\n'),
    'utf8',
  );
}

describe('fragment body/summary validation (PTRY-487)', () => {
  test('a fragment left with the scaffold placeholder body fails collectFragments by name', () => {
    const { rootDir, config } = makeFixtureRoot();
    try {
      writeFragment(rootDir, 'ui-placeholder.md', 'ui', 'Patch notes page', config.fragmentBodyPlaceholder);

      expect(() => collectFragments(config)).toThrow(
        /ui-placeholder\.md body is still the scaffold placeholder — write the real impact paragraph\./,
      );
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('an empty body still fails with the pre-existing "needs a short body paragraph" error', () => {
    const { rootDir, config } = makeFixtureRoot();
    try {
      writeFragment(rootDir, 'ui-empty.md', 'ui', 'Patch notes page', '');

      expect(() => collectFragments(config)).toThrow(/ui-empty\.md needs a short body paragraph\./);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('a summary ending with a period fails collectFragments by name', () => {
    const { rootDir, config } = makeFixtureRoot();
    try {
      writeFragment(rootDir, 'ui-period.md', 'ui', 'Patch notes page.', 'Added a public patch-notes page.');

      expect(() => collectFragments(config)).toThrow(
        /ui-period\.md summary must not end with '\.' — the renderer emits '\*\*\{summary\}:\*\*'\./,
      );
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('a real body and a clean summary pass', () => {
    const { rootDir, config } = makeFixtureRoot();
    try {
      writeFragment(rootDir, 'ui-clean.md', 'ui', 'Patch notes page', 'Added a public patch-notes page.');

      const fragments = collectFragments(config);

      expect(fragments).toHaveLength(1);
      expect(fragments[0].summary).toBe('Patch notes page');
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('scaffolding a fragment with `note` (writeNewFragment) and then checking it fails with the placeholder message', () => {
    const { rootDir, config } = makeFixtureRoot();
    try {
      writeNewFragment(config, { kind: 'ui', slug: 'settings-polish', summary: 'Settings polish' });

      const result = validateReleaseState(config);

      expect(result.ok).toBe(false);
      expect(result.errors.join('\n')).toMatch(
        /ui-settings-polish\.md body is still the scaffold placeholder — write the real impact paragraph\./,
      );
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('a freshly scaffolded placeholder fragment fails `hygiene` by name without throwing (hygiene ratchet)', () => {
    // Was: "does not break hygiene (path/presence checks only, no body
    // parsing)". hygiene now reads the body of fragments THIS change touches
    // (still never throws — it reports via HygieneResult, same as every
    // other hygiene failure mode) so a just-scaffolded placeholder is caught
    // at push time instead of surviving until `check`/`publish` after a
    // deploy.
    const { rootDir, config } = makeFixtureRoot();
    try {
      writeNewFragment(config, { kind: 'ui', slug: 'settings-polish', summary: 'Settings polish' });

      let result: ReturnType<typeof classifyReleaseHygiene> | undefined;
      expect(() => {
        result = classifyReleaseHygiene(config, ['docs/patch-notes/unreleased/ui-settings-polish.md']);
      }).not.toThrow();

      expect(result?.ok).toBe(false);
      expect(result?.placeholderPatchNoteFiles).toEqual(['docs/patch-notes/unreleased/ui-settings-polish.md']);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('cutRelease refuses to publish a placeholder-body fragment', () => {
    const { rootDir, config } = makeFixtureRoot();
    try {
      writeFragment(rootDir, 'ui-placeholder.md', 'ui', 'Patch notes page', config.fragmentBodyPlaceholder);

      expect(() => cutRelease(config, { date: '2026-07-16' })).toThrow(
        /ui-placeholder\.md body is still the scaffold placeholder — write the real impact paragraph\./,
      );
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
