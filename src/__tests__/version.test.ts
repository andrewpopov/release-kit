import { describe, expect, test } from 'vitest';
import type { ReleaseSummary } from '../render';
import type { ReleaseKindDef } from '../config';
import { alphaSemver, resolveBumpLevel, stableSemver } from '../version';

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

  test('bump matrix: major/minor/patch across the 0.x boundary', () => {
    const strategy = stableSemver();

    expect(strategy.next('0.14.3', { bump: 'major' })).toBe('0.15.0');
    expect(strategy.next('1.14.3', { bump: 'major' })).toBe('2.0.0');
    expect(strategy.next('0.14.3', { bump: 'minor' })).toBe('0.15.0');
    expect(strategy.next('1.14.3', { bump: 'minor' })).toBe('1.15.0');
    expect(strategy.next('1.9.12', { bump: 'patch' })).toBe('1.9.13');
    expect(strategy.next('1.9.12')).toBe('1.9.13');
  });

  test('declares supported bumpLevelSupport', () => {
    expect(stableSemver().bumpLevelSupport).toBe('supported');
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

describe('resolveBumpLevel', () => {
  const kinds: ReleaseKindDef[] = [
    { id: 'breaking', heading: 'Breaking' },
    { id: 'added', heading: 'Added' },
    { id: 'fixed', heading: 'Fixed' },
    { id: 'feature', heading: 'Feature', bump: 'minor' },
  ];

  test('highest bump wins across mixed fragments', () => {
    expect(resolveBumpLevel(['fixed', 'added', 'breaking'], kinds)).toBe('major');
    expect(resolveBumpLevel(['fixed', 'added'], kinds)).toBe('minor');
    expect(resolveBumpLevel(['fixed'], kinds)).toBe('patch');
  });

  test('falls back to conventional defaults: breaking -> major, added -> minor, fixed -> patch', () => {
    expect(resolveBumpLevel(['breaking'], kinds)).toBe('major');
    expect(resolveBumpLevel(['added'], kinds)).toBe('minor');
    expect(resolveBumpLevel(['fixed'], kinds)).toBe('patch');
  });

  test('a non-conventional id can declare its own bump on ReleaseKindDef', () => {
    expect(resolveBumpLevel(['feature'], kinds)).toBe('minor');
  });

  test('empty fragment list resolves to patch', () => {
    expect(resolveBumpLevel([], kinds)).toBe('patch');
  });

  test('an invalid declared bump level throws', () => {
    const badKinds: ReleaseKindDef[] = [{ id: 'weird', heading: 'Weird', bump: 'huge' as never }];

    expect(() => resolveBumpLevel(['weird'], badKinds)).toThrow(
      /Kind "weird" declares an unknown bump level "huge". Expected one of: major, minor, patch\./,
    );
  });

  test('an inherited Object.prototype key is rejected, not silently ranked as patch', () => {
    // A runtime-loaded CJS config is not type-checked, so `bump` can be any
    // string. An `in` check would accept these and rank them as undefined,
    // degrading a breaking release to a patch — the exact silent mislabeling
    // this change removes.
    for (const inherited of ['toString', 'constructor', 'hasOwnProperty']) {
      const badKinds: ReleaseKindDef[] = [{ id: 'weird', heading: 'Weird', bump: inherited as never }];

      expect(() => resolveBumpLevel(['weird'], badKinds)).toThrow(
        new RegExp(`Kind "weird" declares an unknown bump level "${inherited}"\\.`),
      );
    }
  });
});

describe('alphaSemver', () => {
  test('ignores a breaking fragment and still bumps only the trailing counter (documented policy)', () => {
    const strategy = alphaSemver();

    expect(strategy.next('0.1.0-alpha.0', { bump: 'major' })).toBe('0.1.0-alpha.1');
    expect(strategy.bumpLevelSupport).toBe('ignored');
  });
});
