import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { makeRougeConfig } from './fixtures/rougeConfig';
import { cutRelease, validateReleaseState } from '../publish';
import { readDatedReleaseNotes } from '../release-history';
import { announceDatedReleaseToDiscord } from '../dated-announcement';
import type { DiscordFetch } from '../announcement';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dated-target-')); dirs.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'test-product', version: '0.1.0-alpha.0' }));
  const config = { ...makeRougeConfig(root), history: { repository: 'test/product', notesBaseUrl: 'https://test.example/releases' } };
  const unreleased = path.join(root, config.paths.notesDir, 'unreleased');
  fs.mkdirSync(unreleased, { recursive: true });
  fs.writeFileSync(path.join(unreleased, 'fix-care.md'), '---\nkind: fix\nsummary: Better care plans\n---\n\nFull details for the app page.');
  return { root, config, directory: path.join(root, config.paths.notesDir, 'releases') };
}

test('a normal release cut writes a dated file and linked index, archives fragments and validates', () => {
  const { root, config, directory } = fixture();
  const result = cutRelease(config, { date: '2026-10-20', commit: 'abcdef0' });
  expect(path.basename(result.releasePath)).toBe('2026-10-20-0.1.0-alpha.1.md');
  const notes = readDatedReleaseNotes({ directory, repository: 'test/product', product: config.productName });
  expect(notes[0].summary).toBe('Better care plans');
  expect(notes[0].notesMarkdown).toContain('Full details for the app page.');
  expect(fs.readFileSync(path.join(root, config.paths.indexPath), 'utf8')).toContain('2026-10-20-0.1.0-alpha.1.md');
  expect(validateReleaseState(config).ok).toBe(true);
});

test('announces the deployed dated release once with no paid generator or detailed fields', async () => {
  const { root, config } = fixture();
  cutRelease(config, { date: '2026-10-20', commit: 'abcdef0' });
  const fetch = vi.fn<DiscordFetch>(async () => ({ ok: true, status: 204, text: async () => '' }));
  const options = { config, event: { event: 'deployment', status: 'succeeded' },
    env: { DISCORD_RELEASE_WEBHOOK: 'https://discord.com/api/webhooks/1/token' }, fetch,
    stateFile: path.join(root, 'shared', 'announced.json') };
  expect(await announceDatedReleaseToDiscord(options)).toEqual({ posted: true,
    url: 'https://test.example/releases/2026-10-20-0.1.0-alpha.1' });
  const payload = JSON.parse(fetch.mock.calls[0][1].body);
  expect(payload.embeds[0].fields).toEqual([]);
  expect(payload.embeds[0].description).toContain('[Full release notes]');
  expect(payload.embeds[0].description).not.toContain('Full details for the app page.');
  expect(await announceDatedReleaseToDiscord(options)).toMatchObject({ posted: false, reason: 'already-announced' });
  expect(fetch).toHaveBeenCalledOnce();
  expect(await announceDatedReleaseToDiscord({ ...options, event: { event: 'deployment', status: 'failed' } }))
    .toMatchObject({ posted: false, reason: 'deployment-not-succeeded' });
});

test('rolls a failed dated cut back, including the consumed fragments', () => {
  const { root, config, directory } = fixture();
  config.manifest = { ...config.manifest, validateVersionSync: () => ['fixture validation failure'] };
  expect(() => cutRelease(config, { date: '2026-10-20', commit: 'abcdef0' })).toThrow('fixture validation failure');
  expect(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version).toBe('0.1.0-alpha.0');
  expect(fs.existsSync(path.join(root, config.paths.notesDir, 'unreleased', 'fix-care.md'))).toBe(true);
  expect(fs.existsSync(path.join(directory, '2026-10-20-0.1.0-alpha.1.md'))).toBe(false);
});

test('a release check refuses newer fragments left unpublished under an already announced version', () => {
  const { root, config } = fixture();
  cutRelease(config, { date: '2026-10-20', commit: 'abcdef0' });
  const fragment = path.join(root, config.paths.notesDir, 'unreleased', 'fix-newer.md');
  fs.writeFileSync(fragment, '---\nkind: fix\nsummary: A later fix\n---\n\nThis change is not in the published notes.');
  expect(validateReleaseState(config).errors).toContain(
    'Unpublished release notes: cut and commit the dated notes before qualifying this release candidate.',
  );
  expect(validateReleaseState(config).ok).toBe(false);
});
