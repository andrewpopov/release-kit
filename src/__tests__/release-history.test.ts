import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { buildReleaseNotification, createFileReleaseNotesReader, writeDatedReleaseNotes,
  releaseNotesUrl, validateReleaseNotesRecord, type ReleaseNotesRecord } from '../release-history';

const record: ReleaseNotesRecord = {
  schemaVersion: 1, repository: 'popovlabs/jun', id: '2026-10-20-abc1234', product: 'Jun',
  version: '2026.10.20', commit: 'abc1234', releasedAt: '2026-10-20T12:00:00.000Z',
  summary: 'Care plans and feeding controls.', notesMarkdown: '## Health\n\nFull details, never sent to the webhook.',
};
const dirs: string[] = [];
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'release-notes-'));
  dirs.push(directory);
  return { directory, reader: createFileReleaseNotesReader({ directory, repository: record.repository, product: record.product }) };
}
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe('dated release notes', () => {
  test('round-trips a dated Markdown file and keeps existing history immutable', async () => {
    const { directory, reader } = fixture();
    const file = writeDatedReleaseNotes(directory, record);
    expect(path.basename(file)).toBe('2026-10-20-abc1234.md');
    expect(fs.readFileSync(file, 'utf8')).toContain(record.notesMarkdown);
    expect(writeDatedReleaseNotes(directory, record)).toBe(file);
    expect(() => writeDatedReleaseNotes(directory, { ...record, summary: 'A different summary.' })).toThrow('already exists');
    expect(await reader.get(record.repository, record.id)).toEqual(record);
  });

  test('lists reviewed dated files with bounded paging and ignores drafts and readmes', async () => {
    const { directory, reader } = fixture();
    writeDatedReleaseNotes(directory, record);
    const older = { ...record, id: '2026-10-19-older', releasedAt: '2026-10-19T10:00:00.000Z', summary: 'Different older release.' };
    writeDatedReleaseNotes(directory, older);
    fs.writeFileSync(path.join(directory, 'README.md'), 'not a release');
    fs.writeFileSync(path.join(directory, 'unreleased.md'), 'not published');
    expect(await reader.list(record.repository, { pageSize: 1 })).toEqual({ items: [record], hasMore: true, page: 1, pageSize: 1 });
    expect(await reader.list(record.repository, { page: 2, pageSize: 1 })).toEqual({ items: [older], hasMore: false, page: 2, pageSize: 1 });
    await expect(reader.list(record.repository, { pageSize: 1000 })).rejects.toThrow('Invalid release page');
  });

  test('does not expose another repo or allow path traversal', async () => {
    const { directory, reader } = fixture();
    writeDatedReleaseNotes(directory, record);
    expect(await reader.get('other/repo', record.id)).toBeNull();
    expect((await reader.list('other/repo')).items).toEqual([]);
    expect(await reader.get(record.repository, '2026-10-20-missing')).toBeNull();
    await expect(reader.get(record.repository, '../secret')).rejects.toThrow('Invalid release id');
  });

  test('rejects malformed dated files and symlinks rather than silently omitting notes', async () => {
    const { directory, reader } = fixture();
    const file = path.join(directory, '2026-10-20-bad.md');
    fs.writeFileSync(file, 'no metadata');
    await expect(reader.list(record.repository)).rejects.toThrow('front matter');
    fs.unlinkSync(file);
    fs.symlinkSync(path.join(directory, 'README.md'), file);
    fs.writeFileSync(path.join(directory, 'README.md'), 'secret');
    await expect(reader.list(record.repository)).rejects.toThrow('Invalid release note file');
  });

  test('a missing notes directory is empty, without creating files during reads', async () => {
    const { directory } = fixture();
    const absent = path.join(directory, 'absent');
    const reader = createFileReleaseNotesReader({ directory: absent, repository: record.repository, product: record.product });
    expect((await reader.list(record.repository)).items).toEqual([]);
    expect(fs.existsSync(absent)).toBe(false);
  });

  test('every notification is short and links to a stable detail page, never embeds full notes', () => {
    expect(buildReleaseNotification(record, 'https://jun.example/releases')).toEqual({
      title: 'Jun 2026.10.20', summary: record.summary, url: 'https://jun.example/releases/2026-10-20-abc1234',
    });
    expect(() => validateReleaseNotesRecord({ ...record, summary: 'x'.repeat(361) })).toThrow('summary');
    expect(() => releaseNotesUrl('javascript:alert(1)', record.id)).toThrow('HTTP(S)');
    expect(() => releaseNotesUrl('https://jun.example/releases', '../admin')).toThrow('Invalid release id');
  });
});
