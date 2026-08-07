import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { formatPackedBinFailures, verifyPackedBins } from '../packed-bins';

function makeFixtureTarball(
  pkgJson: Record<string, unknown>,
  files: Record<string, { content?: string; mode?: number }>,
): { rootDir: string; tarballPath: string; tempDir: string } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-kit-packed-bins-fixture-'));
  const packageDir = path.join(tempDir, 'package');
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify(pkgJson, null, 2), 'utf8');
  for (const [relativePath, spec] of Object.entries(files)) {
    const filePath = path.join(packageDir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, spec.content ?? '#!/usr/bin/env node\n', 'utf8');
    if (spec.mode !== undefined) {
      fs.chmodSync(filePath, spec.mode);
    }
  }
  const tarballPath = path.join(tempDir, 'fixture.tgz');
  // Bare filename plus cwd, not an absolute path: GNU tar (what Git for
  // Windows puts on PATH) reads a leading `C:` as a remote host spec.
  execFileSync('tar', ['-czf', path.basename(tarballPath), 'package'], { cwd: tempDir });
  return { rootDir: packageDir, tarballPath, tempDir };
}

// Every mode-dependent fixture here is POSIX-only. On Windows the MSYS tar
// that Git for Windows puts on PATH ignores fs.chmod entirely and derives the
// executable bit from CONTENT: a file starting with `#!` is archived 0o755,
// anything else 0o644. Verified directly - chmod 0o644 on a shebang file
// still lands as -rwxr-xr-x, and chmod 0o755 on a non-shebang file lands as
// -rw-r--r--. So a fixture cannot ask for a mode there: the negative cases
// silently stop failing, and the positive ones would pass no matter which
// mode they requested. Skipping is the honest option - the behaviour stays
// covered wherever releases are actually cut.
//
// (npm pack is a separate story: it packs from the fs mode, so on Windows it
// records 0o644 even for a shebang bin. That is why the verify-bins command
// itself skips there.)
const testOnPosix = process.platform === 'win32' ? test.skip : test;

describe('verifyPackedBins', () => {
  testOnPosix('a 755 bin passes with mode 0o755', () => {
    const { rootDir, tarballPath, tempDir } = makeFixtureTarball(
      { name: 'ok-pkg', bin: { 'ok-pkg': 'bin/cli.js' } },
      { 'bin/cli.js': { mode: 0o755 } },
    );
    try {
      const result = verifyPackedBins({ rootDir, tarballPath });
      expect(result.ok).toBe(true);
      expect(result.findings).toEqual([
        { name: 'ok-pkg', target: 'bin/cli.js', entry: 'package/bin/cli.js', mode: 0o755, ok: true, reason: undefined },
      ]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // The account that installs the package owns the extracted file, so Unix
  // applies the OWNER triplet to it. A mode with group/other execute but no
  // owner execute has an execute bit set and still fails with "Permission
  // denied" for the only user who will ever run it — checking `mode & 0o111`
  // would wave these straight through.
  // (A mode with no owner READ bit, e.g. 0o011, is untestable here: `tar` cannot
  // open the file to archive it, so the fixture itself cannot be built.)
  testOnPosix.each([
    [0o655, '-rw-r-xr-x'],
    [0o611, '-rw---x--x'],
  ])('a mode-%s bin (%s) fails: execute bits exist but the owner has none', (mode) => {
    const { rootDir, tarballPath, tempDir } = makeFixtureTarball(
      { name: 'no-owner-exec', bin: { 'no-owner-exec': 'bin/cli.js' } },
      { 'bin/cli.js': { mode } },
    );
    try {
      const result = verifyPackedBins({ rootDir, tarballPath });
      expect(result.ok).toBe(false);
      expect(result.findings[0].reason).toBe('not-executable');
      expect(formatPackedBinFailures(result)).toContain('no-owner-exec');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  testOnPosix('a 644 bin fails as not-executable and the failure names the bin and target path', () => {
    const { rootDir, tarballPath, tempDir } = makeFixtureTarball(
      { name: 'broken-pkg', bin: { 'broken-pkg': 'dist/cli.js' } },
      { 'dist/cli.js': { mode: 0o644 } },
    );
    try {
      const result = verifyPackedBins({ rootDir, tarballPath });
      expect(result.ok).toBe(false);
      expect(result.findings).toEqual([
        { name: 'broken-pkg', target: 'dist/cli.js', entry: 'package/dist/cli.js', mode: 0o644, ok: false, reason: 'not-executable' },
      ]);
      const failures = formatPackedBinFailures(result);
      expect(failures).toContain('broken-pkg');
      expect(failures).toContain('package/dist/cli.js');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('a declared bin whose target is absent from the tarball is flagged missing', () => {
    const { rootDir, tarballPath, tempDir } = makeFixtureTarball({ name: 'missing-pkg', bin: { 'missing-pkg': 'bin/cli.js' } }, {});
    try {
      const result = verifyPackedBins({ rootDir, tarballPath });
      expect(result.ok).toBe(false);
      expect(result.findings).toEqual([
        { name: 'missing-pkg', target: 'bin/cli.js', entry: null, mode: null, ok: false, reason: 'missing' },
      ]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('bin absent entirely yields ok: true and no findings', () => {
    const { rootDir, tarballPath, tempDir } = makeFixtureTarball({ name: 'no-bin-pkg' }, {});
    try {
      const result = verifyPackedBins({ rootDir, tarballPath });
      expect(result.ok).toBe(true);
      expect(result.findings).toEqual([]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  testOnPosix('string-form bin resolves to the package-name key', () => {
    const { rootDir, tarballPath, tempDir } = makeFixtureTarball({ name: 'string-bin-pkg', bin: 'cli.js' }, { 'cli.js': { mode: 0o755 } });
    try {
      const result = verifyPackedBins({ rootDir, tarballPath });
      expect(result.ok).toBe(true);
      expect(result.findings).toEqual([
        { name: 'string-bin-pkg', target: 'cli.js', entry: 'package/cli.js', mode: 0o755, ok: true, reason: undefined },
      ]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  testOnPosix('multiple bins where only one is broken flags exactly that one', () => {
    const { rootDir, tarballPath, tempDir } = makeFixtureTarball(
      { name: 'multi-pkg', bin: { good: 'bin/good.js', bad: 'bin/bad.js' } },
      { 'bin/good.js': { mode: 0o755 }, 'bin/bad.js': { mode: 0o644 } },
    );
    try {
      const result = verifyPackedBins({ rootDir, tarballPath });
      expect(result.ok).toBe(false);
      const byName = Object.fromEntries(result.findings.map((finding) => [finding.name, finding]));
      expect(byName.good.ok).toBe(true);
      expect(byName.bad.ok).toBe(false);
      expect(byName.bad.reason).toBe('not-executable');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  testOnPosix('end-to-end: a real `npm pack` of a fixture package with a 644 bin fails the check', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-kit-packed-bins-e2e-'));
    try {
      fs.writeFileSync(
        path.join(rootDir, 'package.json'),
        JSON.stringify({ name: 'e2e-broken-bin', version: '1.0.0', bin: { 'e2e-broken-bin': 'bin/cli.js' } }, null, 2),
        'utf8',
      );
      fs.mkdirSync(path.join(rootDir, 'bin'), { recursive: true });
      fs.writeFileSync(path.join(rootDir, 'bin', 'cli.js'), '#!/usr/bin/env node\nconsole.log("hi");\n', 'utf8');
      fs.chmodSync(path.join(rootDir, 'bin', 'cli.js'), 0o644);

      const result = verifyPackedBins({ rootDir });
      expect(result.ok).toBe(false);
      expect(result.findings).toEqual([
        {
          name: 'e2e-broken-bin',
          target: 'bin/cli.js',
          entry: 'package/bin/cli.js',
          mode: 0o644,
          ok: false,
          reason: 'not-executable',
        },
      ]);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
