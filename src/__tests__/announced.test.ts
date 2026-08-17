import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  hasAnnouncedVersion,
  readAnnouncedVersions,
  recordAnnouncedVersion,
  resolveAnnouncementStatePath,
} from '../announced';
import { makeRougeConfig } from './fixtures/rougeConfig';

const ENV_KEYS = ['RELEASE_ANNOUNCE_STATE', 'DEPLOY_KIT_SHARED_DIR'] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-kit-announced-'));
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
});

describe('resolveAnnouncementStatePath', () => {
  test('prefers an explicit option over everything else', () => {
    process.env.RELEASE_ANNOUNCE_STATE = path.join(tmpDir, 'env.json');
    const config = makeRougeConfig(tmpDir);
    config.paths.announcementStateFile = 'config-state.json';
    process.env.DEPLOY_KIT_SHARED_DIR = path.join(tmpDir, 'dk-shared');

    const resolution = resolveAnnouncementStatePath(config, {
      stateFile: path.join(tmpDir, 'option.json'),
    });
    expect(resolution).toEqual({
      path: path.join(tmpDir, 'option.json'),
      durable: true,
      source: 'option',
    });
  });

  test('falls back to RELEASE_ANNOUNCE_STATE when no option is given', () => {
    process.env.RELEASE_ANNOUNCE_STATE = path.join(tmpDir, 'env.json');
    const config = makeRougeConfig(tmpDir);
    config.paths.announcementStateFile = 'config-state.json';
    process.env.DEPLOY_KIT_SHARED_DIR = path.join(tmpDir, 'dk-shared');

    const resolution = resolveAnnouncementStatePath(config);
    expect(resolution).toEqual({
      path: path.join(tmpDir, 'env.json'),
      durable: true,
      source: 'env',
    });
  });

  test('falls back to config.paths.announcementStateFile, resolved against rootDir', () => {
    const config = makeRougeConfig(tmpDir);
    config.paths.announcementStateFile = 'nested/config-state.json';
    process.env.DEPLOY_KIT_SHARED_DIR = path.join(tmpDir, 'dk-shared');

    const resolution = resolveAnnouncementStatePath(config);
    expect(resolution).toEqual({
      path: path.join(tmpDir, 'nested/config-state.json'),
      durable: true,
      source: 'config',
    });
  });

  test('falls back to DEPLOY_KIT_SHARED_DIR when config has no path', () => {
    const config = makeRougeConfig(tmpDir);
    process.env.DEPLOY_KIT_SHARED_DIR = path.join(tmpDir, 'dk-shared');

    const resolution = resolveAnnouncementStatePath(config);
    expect(resolution).toEqual({
      path: path.join(tmpDir, 'dk-shared', 'release-announcements.json'),
      durable: true,
      source: 'deploy-kit-shared',
    });
  });

  test('falls back to the real deploy-kit shared/ directory two levels up from rootDir', () => {
    // Real layout: /srv/<app>/releases/<stamp> is rootDir (the physical,
    // symlink-resolved path `current` points at), and shared/ is a sibling
    // of releases/, i.e. two levels up from rootDir — not one.
    const rootDir = path.join(tmpDir, 'app', 'releases', 'stamp-1');
    fs.mkdirSync(rootDir, { recursive: true });
    const twoLevelShared = path.join(tmpDir, 'app', 'shared');
    fs.mkdirSync(twoLevelShared, { recursive: true });
    const config = makeRougeConfig(rootDir);

    const resolution = resolveAnnouncementStatePath(config);
    expect(resolution).toEqual({
      path: path.join(twoLevelShared, 'release-announcements.json'),
      durable: true,
      source: 'sibling-shared',
    });
  });

  test('prefers a one-level-up shared/ directory over two-levels-up when both exist', () => {
    const rootDir = path.join(tmpDir, 'app', 'releases', 'stamp-1');
    fs.mkdirSync(rootDir, { recursive: true });
    const oneLevelShared = path.join(tmpDir, 'app', 'releases', 'shared');
    fs.mkdirSync(oneLevelShared, { recursive: true });
    const twoLevelShared = path.join(tmpDir, 'app', 'shared');
    fs.mkdirSync(twoLevelShared, { recursive: true });
    const config = makeRougeConfig(rootDir);

    const resolution = resolveAnnouncementStatePath(config);
    expect(resolution).toEqual({
      path: path.join(oneLevelShared, 'release-announcements.json'),
      durable: true,
      source: 'sibling-shared',
    });
  });

  test('falls back to a flatter one-level-up shared/ directory when two-levels-up does not exist', () => {
    const rootDir = path.join(tmpDir, 'app', 'releases', 'current');
    fs.mkdirSync(rootDir, { recursive: true });
    const oneLevelShared = path.join(tmpDir, 'app', 'releases', 'shared');
    fs.mkdirSync(oneLevelShared, { recursive: true });
    const config = makeRougeConfig(rootDir);

    const resolution = resolveAnnouncementStatePath(config);
    expect(resolution).toEqual({
      path: path.join(oneLevelShared, 'release-announcements.json'),
      durable: true,
      source: 'sibling-shared',
    });
  });

  test('falls back to a rootDir-local file when nothing else applies, and marks it non-durable', () => {
    const rootDir = path.join(tmpDir, 'app', 'releases', 'current');
    fs.mkdirSync(rootDir, { recursive: true });
    const config = makeRougeConfig(rootDir);

    const resolution = resolveAnnouncementStatePath(config);
    expect(resolution).toEqual({
      path: path.join(rootDir, '.release-announcements.json'),
      durable: false,
      source: 'fallback',
    });
  });
});

describe('readAnnouncedVersions', () => {
  test('returns an empty list for a missing file', () => {
    expect(readAnnouncedVersions(path.join(tmpDir, 'missing.json'))).toEqual({ announced: [] });
  });

  test('returns an empty list for an empty file', () => {
    const statePath = path.join(tmpDir, 'empty.json');
    fs.writeFileSync(statePath, '', 'utf8');
    expect(readAnnouncedVersions(statePath)).toEqual({ announced: [] });
  });

  test('returns an empty list for unparseable JSON', () => {
    const statePath = path.join(tmpDir, 'garbage.json');
    fs.writeFileSync(statePath, '{not json', 'utf8');
    expect(readAnnouncedVersions(statePath)).toEqual({ announced: [] });
  });

  test('degrades junk announced shapes to an empty list without throwing', () => {
    const cases = [
      '{"announced":[null]}',
      '{"announced":"nope"}',
      '{}',
      '{"announced":[1, "two", {"noVersion": true}]}',
    ];
    for (const content of cases) {
      const statePath = path.join(tmpDir, `junk-${cases.indexOf(content)}.json`);
      fs.writeFileSync(statePath, content, 'utf8');
      expect(() => readAnnouncedVersions(statePath)).not.toThrow();
      expect(readAnnouncedVersions(statePath)).toEqual({ announced: [] });
    }
  });

  test('filters entries down to objects with a string version field', () => {
    const statePath = path.join(tmpDir, 'mixed.json');
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        announced: [
          { version: '1.0.0', at: '2026-01-01T00:00:00.000Z' },
          { version: 42 },
          null,
          { at: '2026-01-01T00:00:00.000Z' },
        ],
      }),
      'utf8',
    );
    expect(readAnnouncedVersions(statePath)).toEqual({
      announced: [{ version: '1.0.0', at: '2026-01-01T00:00:00.000Z' }],
    });
  });
});

describe('recordAnnouncedVersion / hasAnnouncedVersion', () => {
  test('records a version and reports it as announced', () => {
    const statePath = path.join(tmpDir, 'state.json');
    expect(hasAnnouncedVersion(statePath, '1.0.0')).toBe(false);

    recordAnnouncedVersion(statePath, '1.0.0');

    expect(hasAnnouncedVersion(statePath, '1.0.0')).toBe(true);
    expect(hasAnnouncedVersion(statePath, '2.0.0')).toBe(false);
  });

  test('creates parent directories as needed', () => {
    const statePath = path.join(tmpDir, 'nested', 'deep', 'state.json');
    recordAnnouncedVersion(statePath, '1.0.0');
    expect(fs.existsSync(statePath)).toBe(true);
    expect(hasAnnouncedVersion(statePath, '1.0.0')).toBe(true);
  });

  test('replaces an existing entry for the same version instead of duplicating it', () => {
    const statePath = path.join(tmpDir, 'state.json');
    recordAnnouncedVersion(statePath, '1.0.0');
    recordAnnouncedVersion(statePath, '1.0.0');
    const { announced } = readAnnouncedVersions(statePath);
    expect(announced.filter((entry) => entry.version === '1.0.0')).toHaveLength(1);
  });

  test('never throws when the write target is unwritable', () => {
    // A directory path used as the state file: mkdirSync/writeFileSync both fail on it.
    const unwritable = path.join(tmpDir, 'i-am-a-directory');
    fs.mkdirSync(unwritable);
    expect(() => recordAnnouncedVersion(unwritable, '1.0.0')).not.toThrow();
  });

  test('writes the ledger atomically via a temp file + rename, leaving no temp file behind', () => {
    const statePath = path.join(tmpDir, 'state.json');
    recordAnnouncedVersion(statePath, '1.0.0');
    const filesAfter = fs.readdirSync(tmpDir);
    expect(filesAfter).toEqual(['state.json']);
    expect(hasAnnouncedVersion(statePath, '1.0.0')).toBe(true);
  });

  test('two products with the same version do not suppress each other', () => {
    const statePath = path.join(tmpDir, 'state.json');
    recordAnnouncedVersion(statePath, '1.0.0', 'angel-snack');

    expect(hasAnnouncedVersion(statePath, '1.0.0', 'angel-snack')).toBe(true);
    expect(hasAnnouncedVersion(statePath, '1.0.0', 'other-app')).toBe(false);

    recordAnnouncedVersion(statePath, '1.0.0', 'other-app');
    expect(hasAnnouncedVersion(statePath, '1.0.0', 'angel-snack')).toBe(true);
    expect(hasAnnouncedVersion(statePath, '1.0.0', 'other-app')).toBe(true);

    const { announced } = readAnnouncedVersions(statePath);
    expect(announced.filter((entry) => entry.version === '1.0.0')).toHaveLength(2);
  });

  test('a legacy entry with no product field still matches and suppresses for the current product', () => {
    const statePath = path.join(tmpDir, 'state.json');
    fs.writeFileSync(
      statePath,
      JSON.stringify({ announced: [{ version: '1.0.0', at: '2026-01-01T00:00:00.000Z' }] }),
      'utf8',
    );

    expect(hasAnnouncedVersion(statePath, '1.0.0', 'angel-snack')).toBe(true);
    expect(hasAnnouncedVersion(statePath, '1.0.0', 'any-other-product')).toBe(true);
    expect(hasAnnouncedVersion(statePath, '1.0.0')).toBe(true);
  });
});
