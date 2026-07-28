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

function packTarball(rootDir: string, destDir: string): string {
  const output = execFileSync('npm', ['pack', '--json', '--pack-destination', destDir], {
    cwd: rootDir,
    encoding: 'utf8',
    timeout: 120000,
  });
  const packInfo = JSON.parse(output) as Array<{ filename: string }>;
  return path.join(destDir, packInfo[0].filename);
}

function listTarballEntries(tarballPath: string): string[] {
  const output = execFileSync('tar', ['-tvzf', tarballPath], {
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
