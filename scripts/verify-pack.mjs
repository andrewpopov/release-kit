#!/usr/bin/env node
/**
 * Pack the package into a tarball, install it into a throwaway project, and
 * assert that:
 *   1. dist/index.d.ts and dist/cli.js ship inside the tarball.
 *   2. CommonJS `require()` exposes the package's core named exports.
 *   3. Native ESM `import { ... }` resolves the same named exports (this is
 *      what catches the "member-expression export" bug where cjs-module-lexer
 *      can't see the names for ESM consumers).
 *   4. The `release-kit` bin runs (`release-kit --help` exits 0).
 *
 * Exits non-zero with a clear message on any failure.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const pkgRoot = new URL('..', import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'));

const EXPECTED_EXPORTS = [
  'defineConfig',
  'resolvePaths',
  'alphaSemver',
  'npmPackage',
  'parseFrontMatter',
  'slugify',
  'todayIso',
  'parseFragment',
  'collectFragments',
  'writeNewFragment',
  'renderReleaseNote',
  'parseReleaseSummary',
  'renderPatchNotesIndex',
  'summarizeReleaseWork',
  'buildAiReleaseSummaryPrompt',
  'generateAiReleaseSummary',
  'buildDiscordReleasePayload',
  'postReleaseToDiscord',
  'announceReleaseToDiscord',
  'createAnthropicReleaseSummaryGenerator',
  'resolveVersion',
  'nextVersion',
  'bumpVersion',
  'publishRelease',
  'validateReleaseState',
  'cutRelease',
  'classifyReleaseHygiene',
  'checkReleaseHygiene',
  'runCli',
];

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', ...opts });
}

function fail(message) {
  console.error(`\n[verify:pack] FAIL: ${message}\n`);
  process.exit(1);
}

const workDir = mkdtempSync(join(tmpdir(), 'release-kit-verify-'));
let tarballPath;

try {
  console.log('[verify:pack] Building...');
  run('npm', ['run', 'build'], { cwd: pkgRoot, stdio: 'inherit' });

  if (!existsSync(join(pkgRoot, 'dist', 'index.d.ts'))) {
    fail('dist/index.d.ts is missing after build');
  }
  if (!existsSync(join(pkgRoot, 'dist', 'cli.js'))) {
    fail('dist/cli.js is missing after build');
  }

  console.log('[verify:pack] Packing tarball...');
  const packOut = run('npm', ['pack', '--json', '--pack-destination', workDir], {
    cwd: pkgRoot,
  });
  const packInfo = JSON.parse(packOut);
  const filename = packInfo[0].filename;
  tarballPath = join(workDir, filename);

  // 1. Assert the declaration file and CLI ship inside the tarball.
  const contents = run('tar', ['-tzf', tarballPath]);
  if (!contents.includes('package/dist/index.d.ts')) {
    fail('dist/index.d.ts is not present in the packed tarball');
  }
  if (!contents.includes('package/dist/cli.js')) {
    fail('dist/cli.js is not present in the packed tarball');
  }
  console.log('[verify:pack] OK: dist/index.d.ts and dist/cli.js ship in tarball');

  // Set up a throwaway consumer project and install the tarball.
  const consumerDir = join(workDir, 'consumer');
  run('mkdir', ['-p', consumerDir]);
  writeFileSync(
    join(consumerDir, 'package.json'),
    JSON.stringify({ name: 'release-kit-consumer', version: '1.0.0', private: true }, null, 2),
  );

  console.log('[verify:pack] Installing tarball into consumer...');
  run('npm', ['install', '--no-audit', '--no-fund', tarballPath], {
    cwd: consumerDir,
    stdio: 'inherit',
  });

  // 2. CommonJS require smoke.
  const cjsSmoke = `
    const mod = require('${pkg.name}');
    const missing = ${JSON.stringify(EXPECTED_EXPORTS)}.filter((n) => typeof mod[n] !== 'function');
    if (missing.length) {
      console.error('CJS missing exports: ' + missing.join(', '));
      process.exit(2);
    }
    console.log('CJS OK');
  `;
  writeFileSync(join(consumerDir, 'smoke.cjs'), cjsSmoke);
  const cjsOut = run('node', ['smoke.cjs'], { cwd: consumerDir });
  if (!cjsOut.includes('CJS OK')) fail('CommonJS smoke did not report OK');
  console.log('[verify:pack] OK: CommonJS require exposes named exports');

  // 3. Native ESM import smoke (catches the member-expression export bug).
  const esmSmoke = `
    import { ${EXPECTED_EXPORTS.join(', ')} } from '${pkg.name}';
    const fns = { ${EXPECTED_EXPORTS.join(', ')} };
    for (const [name, fn] of Object.entries(fns)) {
      if (typeof fn !== 'function') {
        console.error('ESM: ' + name + ' is not a function');
        process.exit(2);
      }
    }
    console.log('ESM OK');
  `;
  writeFileSync(join(consumerDir, 'smoke.mjs'), esmSmoke);
  const esmOut = run('node', ['smoke.mjs'], { cwd: consumerDir });
  if (!esmOut.includes('ESM OK')) fail('ESM smoke did not report OK');
  console.log('[verify:pack] OK: ESM named imports resolve');

  // 4. The `release-kit` bin runs.
  const binPath = join(consumerDir, 'node_modules', '.bin', 'release-kit');
  if (!existsSync(binPath)) {
    fail('release-kit bin was not installed into node_modules/.bin');
  }
  run(binPath, ['--help']);
  console.log('[verify:pack] OK: release-kit --help exits 0');

  console.log('\n[verify:pack] PASS: all checks green');
} finally {
  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}
