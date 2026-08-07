/**
 * Assert every `package.json#bin` is executable IN THE PACKED TARBALL, not
 * merely on disk. `npm install` chmods a bin to 755 on the way in, so any
 * check that runs after an install (including spawning the installed
 * binary) is structurally blind to a source bin shipped at mode 644 — the
 * packed tarball is the only place that defect survives.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export interface PackedBinFinding {
  /** bin name as declared, e.g. `release-kit`. */
  name: string;
  /** declared target as written in package.json, e.g. `dist/cli.js`. */
  target: string;
  /** matching tarball entry (`package/dist/cli.js`), or null when absent. */
  entry: string | null;
  /** parsed octal mode of that entry, or null when absent. */
  mode: number | null;
  ok: boolean;
  reason?: 'missing' | 'not-executable';
}

export interface VerifyPackedBinsResult {
  ok: boolean;
  /**
   * The tarball that was inspected. When `options.tarballPath` was omitted this
   * names a file inside a temp dir that has ALREADY been removed by the time
   * you read it — it is for diagnostics only. Pass `tarballPath` explicitly if
   * you need the artifact to outlive the call.
   */
  tarballPath: string;
  findings: PackedBinFinding[];
}

export interface VerifyPackedBinsOptions {
  /** Package root. Defaults to `process.cwd()`. */
  rootDir?: string;
  /** Pre-packed tarball. When omitted, `npm pack` runs into a temp dir and is cleaned up after. */
  tarballPath?: string;
}

function normalizeBinField(pkg: { name: string; bin?: string | Record<string, string> }): Record<string, string> {
  if (!pkg.bin) {
    return {};
  }
  if (typeof pkg.bin === 'string') {
    const name = pkg.name.includes('/') ? pkg.name.slice(pkg.name.lastIndexOf('/') + 1) : pkg.name;
    return { [name]: pkg.bin };
  }
  return pkg.bin;
}

function toExpectedEntry(target: string): string {
  const normalized = target.replace(/^\.\//, '').split(path.sep).join('/');
  return `package/${normalized}`;
}

function parseSymbolicMode(field: string): number {
  const triplets = [field.slice(1, 4), field.slice(4, 7), field.slice(7, 10)];
  const digits = triplets.map((triplet) => {
    const [read, write, exec] = triplet;
    const readBit = read === 'r' ? 4 : 0;
    const writeBit = write === 'w' ? 2 : 0;
    const execBit = exec === 'x' || exec === 's' || exec === 't' ? 1 : 0;
    return readBit + writeBit + execBit;
  });
  return parseInt(digits.join(''), 8);
}

/**
 * Locate npm's JavaScript entry point, so npm runs as a plain Node script
 * rather than through a shell.
 *
 * `execFileSync('npm', ...)` fails ENOENT on Windows - spawnSync applies no
 * PATHEXT, so `npm.cmd` is never found - and naming `npm.cmd` fails EINVAL
 * because Node >= 20 refuses to spawn `.cmd` without a shell (the
 * CVE-2024-27980 mitigation). Going through a shell instead would mean
 * hand-quoting for cmd.exe, where a backslash does NOT escape a quote,
 * `%VAR%` expands even inside quotes, and `& | < > ^ ( )` stay live in an
 * unquoted argument. Temp paths and usernames can contain those, so that is a
 * real injection surface rather than a theoretical one. Running the .js
 * directly keeps an argv array end to end and needs no quoting anywhere.
 */
function npmCliPath(): string | null {
  const fromNpm = process.env.npm_execpath;
  if (fromNpm && /\.js$/i.test(fromNpm)) {
    // Resolve before testing: npm_execpath may be relative, and these calls
    // run with an explicit cwd, so a bare existsSync could pass here and then
    // fail to resolve when node starts it. Case-insensitive suffix because
    // Windows paths may be spelled .JS.
    const absolute = path.resolve(fromNpm);
    if (fs.existsSync(absolute)) return absolute;
  }
  const bundled = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  return fs.existsSync(bundled) ? bundled : null;
}

function runNpm(args: string[], options: { cwd: string; timeout: number }): string {
  const cli = npmCliPath();
  if (cli) {
    return execFileSync(process.execPath, [cli, ...args], { ...options, encoding: 'utf8' });
  }
  // POSIX fallback: there `npm` on PATH is a real executable.
  return execFileSync('npm', args, { ...options, encoding: 'utf8' });
}

function packTarball(rootDir: string, destDir: string): string {
  const output = runNpm(['pack', '--json', '--pack-destination', destDir], {
    cwd: rootDir,
    timeout: 120000,
  });
  const packInfo = JSON.parse(output) as Array<{ filename: string }>;
  return path.join(destDir, packInfo[0].filename);
}

function listTarballEntries(tarballPath: string): string[] {
  // Run from the tarball's directory and pass only its name. GNU tar — which
  // is what a Git-for-Windows install puts on PATH — reads a leading `C:` as
  // a remote host spec and dies with "Cannot connect to C: resolve failed".
  // Passing a bare filename sidesteps that without needing --force-local,
  // which the bsdtar shipped with Windows does not accept.
  const output = execFileSync('tar', ['-tvzf', path.basename(tarballPath)], {
    cwd: path.dirname(tarballPath),
    encoding: 'utf8',
    timeout: 30000,
  });
  return output.split(/\r?\n/).filter(Boolean);
}

function buildFinding(name: string, target: string, entries: string[]): PackedBinFinding {
  const expectedEntry = toExpectedEntry(target);
  const matchLine = entries.find((line) => line.endsWith(` ${expectedEntry}`));
  if (!matchLine) {
    return { name, target, entry: null, mode: null, ok: false, reason: 'missing' };
  }
  const mode = parseSymbolicMode(matchLine.slice(0, 10));
  // OWNER execute (0o100), not "any execute bit" (0o111): the account that
  // installs the package owns the extracted file, and Unix applies the owner
  // triplet to it — so a mode like 0o655 (`-rw-r-xr-x`) has an execute bit set
  // and still fails with "Permission denied" for the only user who matters.
  const ok = (mode & 0o100) !== 0;
  return { name, target, entry: expectedEntry, mode, ok, reason: ok ? undefined : 'not-executable' };
}

export function verifyPackedBins(options: VerifyPackedBinsOptions = {}): VerifyPackedBinsResult {
  const rootDir = path.resolve(options.rootDir || process.cwd());
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')) as {
    name: string;
    bin?: string | Record<string, string>;
  };
  const bins = normalizeBinField(pkg);

  if (Object.keys(bins).length === 0) {
    return { ok: true, tarballPath: options.tarballPath || '', findings: [] };
  }

  let tarballPath = options.tarballPath;
  let tempDir: string | null = null;
  try {
    if (!tarballPath) {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-kit-packed-bins-'));
      tarballPath = packTarball(rootDir, tempDir);
    }
    const entries = listTarballEntries(tarballPath);
    const findings = Object.entries(bins).map(([name, target]) => buildFinding(name, target, entries));
    return { ok: findings.every((finding) => finding.ok), tarballPath, findings };
  } finally {
    if (tempDir) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  }
}

/** Multi-line, human-readable failure report; '' when `result.ok`. */
export function formatPackedBinFailures(result: VerifyPackedBinsResult): string {
  if (result.ok) {
    return '';
  }
  return result.findings
    .filter((finding) => !finding.ok)
    .map((finding) => {
      if (finding.reason === 'missing') {
        return `${finding.name}: ${toExpectedEntry(finding.target)} is missing from the packed tarball`;
      }
      const modeOctal = finding.mode !== null ? finding.mode.toString(8).padStart(3, '0') : '???';
      return `${finding.name}: ${finding.entry} is mode ${modeOctal}, not executable (consumers get "Permission denied")`;
    })
    .join('\n');
}

/**
 * Windows fallback: check the mode git has RECORDED for each declared bin.
 *
 * This is deliberately NOT equivalent to inspecting the packed tarball, and
 * does not replace it. It exists because on Windows the tarball check cannot
 * run at all — `npm pack` reads the filesystem mode, and NTFS has no
 * executable bit, so every entry comes out 0o644 and every bin is condemned.
 *
 * Git records `100755` vs `100644` per file regardless of the OS that wrote
 * it, and these packages are consumed as `github:owner/repo#vX` dependencies,
 * so the mode in the tag is exactly what an installing consumer receives.
 * That makes it a meaningful source-level check rather than a rubber stamp:
 * it still catches a bin committed non-executable — the defect most likely to
 * be introduced on Windows, where git will not infer the bit from the
 * filesystem.
 */
export function verifyBinModesInGit(options: VerifyPackedBinsOptions = {}): VerifyPackedBinsResult {
  const rootDir = options.rootDir ?? process.cwd();
  const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const findings: PackedBinFinding[] = Object.entries(normalizeBinField(manifest)).map(([name, target]) => {
    let recorded: string;
    try {
      // `:(literal)` disables pathspec magic. `--` only stops option
      // parsing; without this a bin path containing `*`, `?`, `[` or a
      // leading `:` would still be glob-matched and could report on a
      // different indexed file than the one declared.
      recorded = execFileSync('git', ['ls-files', '-s', '--', `:(literal)${target}`], {
        cwd: rootDir,
        encoding: 'utf8',
        timeout: 30000,
      }).trim();
    } catch {
      recorded = '';
    }
    if (!recorded) {
      return { name, target, entry: null, mode: null, ok: false, reason: 'missing' };
    }
    const mode = parseInt(recorded.slice(0, 6), 8) & 0o7777;
    const ok = (mode & 0o100) !== 0;
    return {
      name,
      target,
      entry: target,
      mode,
      ok,
      reason: ok ? undefined : 'not-executable',
    };
  });
  return { ok: findings.every((finding) => finding.ok), tarballPath: '(git index)', findings };
}
