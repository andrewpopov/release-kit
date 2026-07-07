// Proves titleTemplate back-compat: the package must parse rouge's REAL,
// already-published release files unchanged when configured with
// productName="Angel Snack" (the plan's refinement #5 / risk #1 fix).

import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseReleaseSummary } from '../render';
import { validateReleaseState } from '../publish';
import { collectChangedFiles } from '../hygiene';
import { makeRougeConfig } from './fixtures/rougeConfig';

const ROUGE_ROOT = path.resolve(__dirname, '../../../rouge');
const ROUGE_RELEASES_DIR = path.join(ROUGE_ROOT, 'docs', 'patch-notes', 'releases');

const rougeCheckoutExists = fs.existsSync(ROUGE_RELEASES_DIR);
const describeIfRouge = rougeCheckoutExists ? describe : describe.skip;

describeIfRouge('parses rouge real published release files (titleTemplate back-compat)', () => {
  const releaseFiles = fs
    .readdirSync(ROUGE_RELEASES_DIR)
    .filter((fileName) => fileName.endsWith('.md') && fileName !== 'README.md');

  test('finds at least one real release file to check against', () => {
    expect(releaseFiles.length).toBeGreaterThan(0);
  });

  test.each(releaseFiles)('parses %s with the exact title anchor rouge published', (fileName) => {
    const config = makeRougeConfig(ROUGE_ROOT);
    const summary = parseReleaseSummary(config, path.join(ROUGE_RELEASES_DIR, fileName));
    const expectedVersion = fileName.replace(/\.md$/, '');

    // The title-anchored version must be recovered exactly — this is the
    // load-bearing parse the extraction survey flagged as risk #1.
    expect(summary.titleVersion).toBe(expectedVersion);
    expect(summary.version).toBe(expectedVersion);
    expect(summary.stage.toLowerCase()).toBe('alpha');
    expect(summary.packageVersion).toBe(expectedVersion);
    expect(summary.date).not.toBe('');
  });

  test('validateReleaseState runs clean against rouge real working tree metadata', () => {
    const config = makeRougeConfig(ROUGE_ROOT);
    const pkg = JSON.parse(fs.readFileSync(path.join(ROUGE_ROOT, 'package.json'), 'utf8')) as { version: string };
    const validation = validateReleaseState(config, pkg.version);
    expect(validation.version).toBe(pkg.version);
    expect(validation.errors).toEqual([]);
    expect(validation.ok).toBe(true);
  });

  test('collectChangedFiles runs against the real rouge git repo without throwing', () => {
    // Smoke-tests the generic git collector (merge-base + diff + untracked)
    // against a real, non-fixture repository. We do not assert on the
    // (working-tree-dependent) result, only that it behaves.
    expect(() => collectChangedFiles(ROUGE_ROOT, 'HEAD')).not.toThrow();
  });
});
