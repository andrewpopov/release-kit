import { describe, expect, test } from 'vitest';
import type { ReleaseSummary } from '../render';
import { stableSemver } from '../version';

function summary(version: string, date = '2026-07-16'): ReleaseSummary {
  return {
    version,
    titleVersion: version,
    date,
    stage: 'stable',
    packageVersion: version,
    fileName: `${version}.md`,
  };
}

describe('stableSemver', () => {
  test('requires three numeric stable-semver components', () => {
    const strategy = stableSemver({ versionLabel: 'Service version' });

    expect(() => strategy.assert('1.0.0')).not.toThrow();
    expect(() => strategy.assert('1.0')).toThrow(/Service version.*must use stable semver/);
    expect(() => strategy.assert('1.0.0-alpha.1')).toThrow(/must use stable semver/);
  });

  test('defaults automatic releases to a patch bump', () => {
    expect(stableSemver().next('1.9.12')).toBe('1.9.13');
  });

  test('sorts versions numerically newest-first', () => {
    const versions = [summary('1.9.9'), summary('2.0.0'), summary('1.10.0')];

    expect(versions.sort(stableSemver().compareDesc).map(({ version }) => version)).toEqual([
      '2.0.0',
      '1.10.0',
      '1.9.9',
    ]);
  });

  test('uses the stable version as the release file name', () => {
    expect(stableSemver().releaseFileName('2.3.4')).toBe('2.3.4.md');
  });
});
