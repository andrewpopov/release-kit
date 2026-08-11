// PKG-140 pass 2, findings 3 and 4: `createReleaseArtifactV1` used to
// re-derive its `renderedNotes`/`date` by re-reading and re-parsing
// `result.releasePath`, and its `product`/`repository` by reading
// `package.json` directly off `rootDir`. Both bypassed seams the rest of
// the package already has: the notes target knows exactly what it just
// wrote (finding 3), and `VersionManifestAdapter` is the configured seam
// for manifest-derived data (finding 4). These tests exercise the two
// decisive cases named in the audit: a `changelogTarget()` cut against a
// CHANGELOG that already has prior versions (an empty changelog would pass
// against the old, buggy re-parse and prove nothing), and a custom manifest
// adapter with no `package.json` at the root at all.

import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ReleaseKitConfig } from '../config';
import type { ReleaseNotesTarget } from '../notes-target';
import type { VersionManifestAdapter } from '../manifest';
import { npmPackage } from '../manifest';
import { changelogTarget, patchNotesDirTarget } from '../notes-target';
import { cutRelease, createReleaseArtifactV1 } from '../publish';
import { stableSemver } from '../version';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'release-kit-artifact-'));
}

function baseConfig(rootDir: string, manifest: VersionManifestAdapter, notesTarget: ReleaseNotesTarget): ReleaseKitConfig {
  return {
    productName: 'Artifact App',
    stage: 'stable',
    rootDir,
    paths: { notesDir: 'docs/patch-notes', indexPath: 'docs/PATCH_NOTES.md' },
    kinds: [{ id: 'fixed', heading: 'Fixed' }],
    versionStrategy: stableSemver(),
    manifest,
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

function writeFragment(rootDir: string, slug: string, summary: string, body: string): void {
  fs.mkdirSync(path.join(rootDir, 'docs', 'patch-notes', 'unreleased'), { recursive: true });
  fs.writeFileSync(
    path.join(rootDir, 'docs', 'patch-notes', 'unreleased', `fixed-${slug}.md`),
    ['---', 'kind: fixed', `summary: ${summary}`, '---', '', body, ''].join('\n'),
    'utf8',
  );
}

describe('createReleaseArtifactV1 is target-neutral (PKG-140 finding 3)', () => {
  test('a changelogTarget() cut against a CHANGELOG with prior versions yields an artifact scoped to only the new release, with a real date', () => {
    const rootDir = makeTmpDir();
    try {
      fs.writeFileSync(path.join(rootDir, 'package.json'), `${JSON.stringify({ name: 'artifact-app', version: '1.2.0' }, null, 2)}\n`, 'utf8');
      fs.writeFileSync(
        path.join(rootDir, 'CHANGELOG.md'),
        [
          '# Changelog',
          '',
          '## 1.2.0',
          '',
          '- An ancient, unrelated historical note that must never leak into a new release artifact.',
          '',
        ].join('\n'),
        'utf8',
      );
      writeFragment(rootDir, 'thing', 'Fixed a thing', 'A real impact paragraph.');

      const config = baseConfig(rootDir, npmPackage(), changelogTarget());
      const result = cutRelease(config, { date: '2026-08-01', commit: 'abc1234' });
      const artifact = createReleaseArtifactV1(config, result, 'abc1234');

      // Correct, non-empty date for the release just cut.
      expect(artifact.date).toBe('2026-08-01');
      // Contains only the new version's section...
      expect(artifact.renderedNotes).toContain('## 1.2.1');
      expect(artifact.renderedNotes).toContain('Fixed a thing');
      // ...and NONE of the prior, unrelated version's content or heading.
      expect(artifact.renderedNotes).not.toContain('An ancient, unrelated historical note');
      expect(artifact.renderedNotes).not.toContain('## 1.2.0');
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});

describe('createReleaseArtifactV1 goes through the manifest-adapter seam (PKG-140 finding 4)', () => {
  test('a custom manifest adapter with no package.json at the root still produces a valid artifact', () => {
    const rootDir = makeTmpDir();
    try {
      expect(fs.existsSync(path.join(rootDir, 'package.json'))).toBe(false);
      writeFragment(rootDir, 'thing', 'Fixed a thing', 'A real impact paragraph.');

      let storedVersion = '1.0.0';
      const inMemoryManifest: VersionManifestAdapter = {
        readVersion: () => storedVersion,
        writeVersion: (_rootDir, version) => {
          storedVersion = version;
        },
      };
      const config = baseConfig(rootDir, inMemoryManifest, patchNotesDirTarget());

      const result = cutRelease(config, { date: '2026-08-01', commit: 'abc1234' });
      const artifact = createReleaseArtifactV1(config, result, 'abc1234');

      expect(artifact.version).toBe('1.0.1');
      // No readArtifactMetadata on this adapter: falls back to config, never to a package.json read.
      expect(artifact.product).toBe('Artifact App');
      expect(artifact.repository).toBe(rootDir);
      expect(fs.existsSync(path.join(rootDir, 'package.json'))).toBe(false);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
