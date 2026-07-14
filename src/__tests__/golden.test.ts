// GOLDEN PARITY TEST.
//
// Method: build one fixture tree, copy it into two tmpdirs (rougeDir /
// kitDir). Drive rougeDir with rouge's REAL, unmodified scripts (required
// directly from /Users/andrew/proj/rouge/scripts/*.js via createRequire, and
// invoked through their exported `run(argv, stdout, stderr)` CLI entry
// points — the exact same function `npm run release:*` calls). Drive kitDir
// with release-kit's CLI (`runCli`) configured with rouge's exact values
// (`makeRougeConfig`). Every command's stdout/stderr and every resulting
// file (release notes, archive, PATCH_NOTES.md index, package.json,
// package-lock.json) is diffed byte-for-byte between the two trees.
//
// The rouge scripts are byte-frozen under src/__tests__/fixtures/rouge-frozen/
// (captured from rouge@8f733623b, the commit before rouge adopted this
// package), so the parity check is HERMETIC: it needs no external checkout,
// runs in CI, and never goes circular now that the live rouge scripts are thin
// wrappers over release-kit. Re-freeze only to intentionally re-baseline.

import { describe, expect, test, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { run as runCli } from '../cli';
import { makeRougeConfig } from './fixtures/rougeConfig';

const ROUGE_ROOT = path.resolve(__dirname, 'fixtures/rouge-frozen');

const requireFromHere = createRequire(import.meta.url);

interface RougeCliModule {
  run(argv: string[], stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream): number;
}

function loadRougeScript(relativePath: string): RougeCliModule {
  // Require against the byte-frozen rouge scripts (self-contained, node-builtins
  // only), so no rouge checkout or node_modules is needed.
  return requireFromHere(path.join(ROUGE_ROOT, 'scripts', relativePath)) as RougeCliModule;
}

function capture(): { stream: NodeJS.WritableStream; text: () => string } {
  const chunks: string[] = [];
  const stream = {
    write(chunk: unknown): boolean {
      chunks.push(String(chunk));
      return true;
    },
  } as unknown as NodeJS.WritableStream;
  return { stream, text: () => chunks.join('') };
}

function writeBaseFixture(rootDir: string, version: string): void {
  fs.mkdirSync(path.join(rootDir, 'docs', 'patch-notes', 'unreleased'), { recursive: true });
  fs.writeFileSync(
    path.join(rootDir, 'package.json'),
    `${JSON.stringify({ name: 'angel-snack', version }, null, 2)}\n`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(rootDir, 'package-lock.json'),
    `${JSON.stringify(
      { name: 'angel-snack', version, lockfileVersion: 3, packages: { '': { name: 'angel-snack', version } } },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

function gitInitCommit(rootDir: string): void {
  const run = (args: string[]) => execFileSync('git', args, { cwd: rootDir, stdio: 'ignore' });
  run(['init', '-q']);
  run(['config', 'user.email', 'golden@example.com']);
  run(['config', 'user.name', 'Golden']);
  run(['add', '.']);
  run(['commit', '-q', '-m', 'initial']);
}

function listFilesRecursive(root: string): string[] {
  const result: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        result.push(path.relative(root, full));
      }
    }
  };
  if (fs.existsSync(root)) {
    walk(root);
  }
  return result.sort((a, b) => a.localeCompare(b));
}

/** Asserts every file under `relPaths` (files or directories) is byte-identical between the two roots. */
function assertTreesIdentical(rougeDir: string, kitDir: string, relPaths: string[]): void {
  for (const relPath of relPaths) {
    const rougePath = path.join(rougeDir, relPath);
    const kitPath = path.join(kitDir, relPath);
    const rougeExists = fs.existsSync(rougePath);
    expect(fs.existsSync(kitPath)).toBe(rougeExists);
    if (!rougeExists) continue;
    if (fs.statSync(rougePath).isDirectory()) {
      const rougeFiles = listFilesRecursive(rougePath);
      const kitFiles = listFilesRecursive(kitPath);
      expect(kitFiles).toEqual(rougeFiles);
      for (const file of rougeFiles) {
        const rougeContent = fs.readFileSync(path.join(rougePath, file), 'utf8');
        const kitContent = fs.readFileSync(path.join(kitPath, file), 'utf8');
        expect(kitContent, `${relPath}/${file} must be byte-identical`).toBe(rougeContent);
      }
    } else {
      const rougeContent = fs.readFileSync(rougePath, 'utf8');
      const kitContent = fs.readFileSync(kitPath, 'utf8');
      expect(kitContent, `${relPath} must be byte-identical`).toBe(rougeContent);
    }
  }
}

const TREE_PATHS = ['docs', 'package.json', 'package-lock.json'];

describe('golden parity: release-kit vs rouge real scripts', () => {
  let rougeDir: string;
  let kitDir: string;
  let cutRelease: RougeCliModule;
  let releaseNotes: RougeCliModule;
  let checkHygiene: RougeCliModule;

  beforeAll(() => {
    cutRelease = loadRougeScript('cut-release.js');
    releaseNotes = loadRougeScript('release-notes.js');
    checkHygiene = loadRougeScript('check-release-hygiene.js');

    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'release-kit-golden-base-'));
    writeBaseFixture(base, '0.9.0-alpha.0');

    rougeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-kit-golden-rouge-'));
    kitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-kit-golden-kit-'));
    fs.cpSync(base, rougeDir, { recursive: true });
    fs.cpSync(base, kitDir, { recursive: true });
    fs.rmSync(base, { recursive: true, force: true });

    gitInitCommit(rougeDir);
    gitInitCommit(kitDir);
  });

  interface Invocation {
    code: number | null;
    stdout: string;
    stderr: string;
    /** Set when `run()` threw synchronously — rouge's scripts do this for any
     * error when called programmatically (not via `node script.js`); only the
     * `require.main === module` bin entry catches. release-kit's CLI mirrors
     * this exactly (see cli.ts) for structural parity. */
    thrown: string | null;
  }

  function runRouge(mod: RougeCliModule, argv: string[]): Invocation {
    const out = capture();
    const err = capture();
    try {
      const code = mod.run(argv, out.stream, err.stream);
      return { code, stdout: out.text(), stderr: err.text(), thrown: null };
    } catch (error) {
      return { code: null, stdout: out.text(), stderr: err.text(), thrown: error instanceof Error ? error.message : String(error) };
    }
  }

  function runKit(argv: string[]): Invocation {
    const out = capture();
    const err = capture();
    const config = makeRougeConfig(kitDir);
    try {
      const code = runCli(argv, out.stream, err.stream, { config });
      return { code, stdout: out.text(), stderr: err.text(), thrown: null };
    } catch (error) {
      return { code: null, stdout: out.text(), stderr: err.text(), thrown: error instanceof Error ? error.message : String(error) };
    }
  }

  test('note x3: stdout and fragment files are byte-identical', () => {
    const fragments: Array<[string, string, string]> = [
      ['gameplay', 'town-flow', 'Town flow polish'],
      ['fix', 'save-restore', 'Fix save restore'],
      ['ops', 'release-ritual', 'Release ritual'],
    ];
    for (const [kind, slug, summary] of fragments) {
      const rougeResult = runRouge(releaseNotes, [
        '--new',
        '--kind',
        kind,
        '--slug',
        slug,
        '--summary',
        summary,
        '--root',
        rougeDir,
      ]);
      const kitResult = runKit(['note', '--kind', kind, '--slug', slug, '--summary', summary]);
      expect(kitResult.code).toBe(rougeResult.code);
      expect(kitResult.stdout).toBe(rougeResult.stdout);
      expect(kitResult.stderr).toBe(rougeResult.stderr);
      expect(kitResult.thrown).toBe(rougeResult.thrown);
    }

    // The fragment BODIES are placeholder text (rouge's --new writes a fixed
    // placeholder) — overwrite each with a real body so the release note
    // renders non-trivial content, identically on both sides.
    const bodies: Record<string, string> = {
      'gameplay-town-flow.md': 'Improved reward pacing after elite fights so the next choice is easier to scan.',
      'fix-save-restore.md': 'Fixed a bug where reloading mid-combat dropped the player to the world map.',
      'ops-release-ritual.md': 'Documented the alpha release flow and patch-note fragment process.',
    };
    for (const [fileName, body] of Object.entries(bodies)) {
      for (const dir of [rougeDir, kitDir]) {
        const filePath = path.join(dir, 'docs', 'patch-notes', 'unreleased', fileName);
        const source = fs.readFileSync(filePath, 'utf8');
        const [, meta] = source.split('---\n');
        fs.writeFileSync(filePath, `---\n${meta}---\n\n${body}\n`, 'utf8');
      }
    }

    assertTreesIdentical(rougeDir, kitDir, TREE_PATHS);
  });

  test('hygiene: satisfied-by-fragment stdout is byte-identical', () => {
    fs.mkdirSync(path.join(rougeDir, 'src', 'ui'), { recursive: true });
    fs.mkdirSync(path.join(kitDir, 'src', 'ui'), { recursive: true });
    fs.writeFileSync(path.join(rougeDir, 'src', 'ui', 'town-view.ts'), 'export {};\n', 'utf8');
    fs.writeFileSync(path.join(kitDir, 'src', 'ui', 'town-view.ts'), 'export {};\n', 'utf8');

    const rougeResult = runRouge(checkHygiene, ['--base', 'HEAD', '--root', rougeDir]);
    const kitResult = runKit(['hygiene', '--base', 'HEAD']);
    expect(kitResult.code).toBe(rougeResult.code);
    expect(kitResult.stdout).toBe(rougeResult.stdout);
    expect(kitResult.stderr).toBe(rougeResult.stderr);
    expect(kitResult.thrown).toBe(rougeResult.thrown);
    expect(rougeResult.code).toBe(0);
  });

  test('notes (preview): rendered release note is byte-identical', () => {
    const rougeResult = runRouge(releaseNotes, ['--date', '2026-07-04', '--commit', 'abc1234', '--root', rougeDir]);
    const commit = rougeResult.stdout.match(/^Commit: (.+)$/m)?.[1];
    if (!commit) throw new Error('Rouge preview did not render a commit');
    // Rouge itself ignores --commit for preview and reads its own worktree HEAD.
    // Feed that rendered value to release-kit so this parity assertion compares
    // the release-note format, not two unrelated fixture repositories' HEADs.
    const kitResult = runKit(['notes', '--date', '2026-07-04', '--commit', commit]);
    expect(kitResult.stdout).toBe(rougeResult.stdout);
    expect(kitResult.stderr).toBe(rougeResult.stderr);
    expect(kitResult.code).toBe(rougeResult.code);
    expect(kitResult.thrown).toBe(rougeResult.thrown);
  });

  test('notes uses an explicit commit rather than reading each worktree HEAD', () => {
    const result = runKit(['notes', '--date', '2026-07-04', '--commit', 'pinned-sha']);
    expect(result.stdout).toContain('Commit: pinned-sha');
  });

  test('cut: stdout, release file, archive, index, package.json/lock all byte-identical', () => {
    const rougeResult = runRouge(cutRelease, ['--date', '2026-07-04', '--commit', 'abc1234', '--root', rougeDir]);
    const kitResult = runKit(['cut', '--date', '2026-07-04', '--commit', 'abc1234']);
    expect(kitResult.stdout).toBe(rougeResult.stdout);
    expect(kitResult.stderr).toBe(rougeResult.stderr);
    expect(kitResult.code).toBe(rougeResult.code);
    expect(kitResult.thrown).toBe(rougeResult.thrown);
    assertTreesIdentical(rougeDir, kitDir, TREE_PATHS);
  });

  test('check: post-cut validation stdout is byte-identical', () => {
    const rougeResult = runRouge(releaseNotes, ['--check', '--root', rougeDir]);
    const kitResult = runKit(['check']);
    expect(kitResult.stdout).toBe(rougeResult.stdout);
    expect(kitResult.stderr).toBe(rougeResult.stderr);
    expect(kitResult.code).toBe(rougeResult.code);
    expect(kitResult.thrown).toBe(rougeResult.thrown);
  });

  test('cut --allow-empty on a fragment-less repo: stdout and files byte-identical', () => {
    const rougeResult = runRouge(cutRelease, [
      '--allow-empty',
      '--date',
      '2026-07-05',
      '--commit',
      'def5678',
      '--root',
      rougeDir,
    ]);
    const kitResult = runKit(['cut', '--allow-empty', '--date', '2026-07-05', '--commit', 'def5678']);
    expect(kitResult.stdout).toBe(rougeResult.stdout);
    expect(kitResult.stderr).toBe(rougeResult.stderr);
    expect(kitResult.code).toBe(rougeResult.code);
    expect(kitResult.thrown).toBe(rougeResult.thrown);
    assertTreesIdentical(rougeDir, kitDir, TREE_PATHS);
  });

  test('publish --force --allow-empty: overwrite stdout and release file byte-identical', () => {
    // At this point (post cut --allow-empty) there are zero unreleased
    // fragments, so re-publishing the CURRENT version requires both
    // --allow-empty (no fragments) and --force (the release file for the
    // current version already exists from the prior cut).
    const rougeResult = runRouge(releaseNotes, [
      '--publish',
      '--force',
      '--allow-empty',
      '--date',
      '2026-07-06',
      '--commit',
      'ghi9012',
      '--root',
      rougeDir,
    ]);
    const kitResult = runKit(['publish', '--force', '--allow-empty', '--date', '2026-07-06', '--commit', 'ghi9012']);
    expect(kitResult.stdout).toBe(rougeResult.stdout);
    expect(kitResult.stderr).toBe(rougeResult.stderr);
    expect(kitResult.code).toBe(rougeResult.code);
    expect(kitResult.thrown).toBe(rougeResult.thrown);
    assertTreesIdentical(rougeDir, kitDir, TREE_PATHS);
  });

  test('bump: stdout and manifest bump byte-identical', () => {
    const rougeResult = runRouge(releaseNotes, ['--bump', '--root', rougeDir]);
    const kitResult = runKit(['bump']);
    expect(kitResult.stdout).toBe(rougeResult.stdout);
    expect(kitResult.stderr).toBe(rougeResult.stderr);
    expect(kitResult.code).toBe(rougeResult.code);
    expect(kitResult.thrown).toBe(rougeResult.thrown);
    assertTreesIdentical(rougeDir, kitDir, ['package.json', 'package-lock.json']);
  });

  test('publish without fragments (no --allow-empty): identical thrown refusal error', () => {
    const rougeResult = runRouge(releaseNotes, ['--publish', '--root', rougeDir]);
    const kitResult = runKit(['publish']);
    expect(kitResult.code).toBe(rougeResult.code);
    expect(kitResult.code).toBeNull();
    expect(kitResult.thrown).toBe(rougeResult.thrown);
    expect(kitResult.thrown).toMatch(/No unreleased patch-note fragments/);
    expect(kitResult.stdout).toBe(rougeResult.stdout);
    expect(kitResult.stderr).toBe(rougeResult.stderr);
  });

  test('hygiene after cut: release-file coverage stdout byte-identical', () => {
    const rougeResult = runRouge(checkHygiene, ['--base', 'HEAD', '--root', rougeDir]);
    const kitResult = runKit(['hygiene', '--base', 'HEAD']);
    expect(kitResult.stdout).toBe(rougeResult.stdout);
    expect(kitResult.stderr).toBe(rougeResult.stderr);
    expect(kitResult.code).toBe(rougeResult.code);
    expect(kitResult.thrown).toBe(rougeResult.thrown);
  });
});
