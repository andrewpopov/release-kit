// Proves titleTemplate back-compat: the package must parse rouge's REAL,
// already-published release files unchanged when configured with
// productName="Angel Snack" (the plan's refinement #5 / risk #1 fix).
//
// The files are byte-frozen under fixtures/rouge-frozen/releases/ (captured from
// rouge@8f733623b), so this runs hermetically in CI. Broader
// validateReleaseState / collectChangedFiles coverage lives in the golden
// parity test, which drives the frozen rouge scripts end-to-end.

import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseReleaseSummary } from '../render';
import { makeRougeConfig } from './fixtures/rougeConfig';

const FROZEN_ROOT = path.resolve(__dirname, 'fixtures/rouge-frozen');
const RELEASES_DIR = path.join(FROZEN_ROOT, 'releases');

const releaseFiles = fs
  .readdirSync(RELEASES_DIR)
  .filter((fileName) => fileName.endsWith('.md') && fileName !== 'README.md');

describe('parses rouge real published release files (titleTemplate back-compat)', () => {
  test('finds real release files to check against', () => {
    expect(releaseFiles.length).toBeGreaterThan(0);
  });

  test.each(releaseFiles)('parses %s with the exact title anchor rouge published', (fileName) => {
    const config = makeRougeConfig(FROZEN_ROOT);
    const summary = parseReleaseSummary(config, path.join(RELEASES_DIR, fileName));
    const expectedVersion = fileName.replace(/\.md$/, '');

    // The title-anchored version must be recovered exactly — this is the
    // load-bearing parse the extraction survey flagged as risk #1.
    expect(summary.titleVersion).toBe(expectedVersion);
    expect(summary.version).toBe(expectedVersion);
    expect(summary.stage.toLowerCase()).toBe('alpha');
    expect(summary.packageVersion).toBe(expectedVersion);
    expect(summary.date).not.toBe('');
  });
});
