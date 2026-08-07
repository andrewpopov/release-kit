import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { formatPackedBinFailures, verifyBinModesInGit, verifyPackedBins } from '../packed-bins';

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

// The Windows fallback: it reads the mode git RECORDED, so it works on every
// platform and can be tested on every platform.
describe('verifyBinModesInGit', () => {
  function gitFixture(pkgJson: Record<string, unknown>, files: Record<string, string>, mode: '100644' | '100755') {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-kit-gitmode-'));
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: rootDir, encoding: 'utf8', stdio: 'pipe' });
    git('init', '-q', '.');
    fs.writeFileSync(path.join(rootDir, 'package.json'), JSON.stringify(pkgJson, null, 2), 'utf8');
    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = path.join(rootDir, relativePath);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, 'utf8');
    }
    git('add', '-A');
    // Set the recorded mode explicitly so this does not depend on the host
    // filesystem carrying an executable bit.
    for (const relativePath of Object.keys(files)) {
      git('update-index', `--chmod=${mode === '100755' ? '+x' : '-x'}`, relativePath);
    }
    return { rootDir };
  }

  test('a bin recorded 100755 in the index passes', () => {
    const { rootDir } = gitFixture(
      { name: 'git-ok', bin: { 'git-ok': 'bin/cli.js' } },
      { 'bin/cli.js': '#!/usr/bin/env node\n' },
      '100755',
    );
    try {
      const result = verifyBinModesInGit({ rootDir });
      expect(result.ok).toBe(true);
      expect(result.findings[0].mode).toBe(0o755);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('a bin recorded 100644 in the index fails as not-executable', () => {
    const { rootDir } = gitFixture(
      { name: 'git-bad', bin: { 'git-bad': 'bin/cli.js' } },
      { 'bin/cli.js': '#!/usr/bin/env node\n' },
      '100644',
    );
    try {
      const result = verifyBinModesInGit({ rootDir });
      expect(result.ok).toBe(false);
      expect(result.findings[0].reason).toBe('not-executable');
      expect(formatPackedBinFailures(result)).toContain('git-bad');
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('a bin that is not tracked at all is flagged missing', () => {
    const { rootDir } = gitFixture(
      { name: 'git-untracked', bin: { 'git-untracked': 'bin/absent.js' } },
      { 'bin/present.js': '#!/usr/bin/env node\n' },
      '100755',
    );
    try {
      const result = verifyBinModesInGit({ rootDir });
      expect(result.ok).toBe(false);
      expect(result.findings[0].reason).toBe('missing');
      expect(result.findings[0].mode).toBeNull();
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  // Without `:(literal)`, git treats the declared target as a pathspec, so a
  // wildcard would glob onto a DIFFERENT indexed file and report that file's
  // mode instead. Here the only real match is non-executable; a glob would
  // find the executable sibling and wrongly pass.
  test('a bin path containing a wildcard is matched literally, not globbed', () => {
    const { rootDir } = gitFixture(
      { name: 'git-glob', bin: { 'git-glob': 'bin/c*.js' } },
      { 'bin/cli.js': '#!/usr/bin/env node\n' },
      '100755',
    );
    try {
      const result = verifyBinModesInGit({ rootDir });
      expect(result.ok).toBe(false);
      expect(result.findings[0].reason).toBe('missing');
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
