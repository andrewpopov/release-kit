#!/usr/bin/env node
/**
 * `release-kit` CLI — 7 verbs matching rouge's npm scripts:
 * note | notes(preview) | bump | publish | cut | check | hygiene.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ReleaseKitConfig } from './config';
import { checkReleaseHygiene } from './hygiene';
import { collectFragments, todayIso, writeNewFragment } from './fragments';
import { formatPackedBinFailures, verifyPackedBins } from './packed-bins';
import { renderReleaseNote } from './render';
import {
  bumpVersion,
  cutRelease,
  createReleaseArtifactV1,
  getGitShortSha,
  publishRelease,
  resolveVersion,
  validateReleaseState,
} from './publish';

interface ParsedArgs {
  verb: string;
  rootDir?: string;
  version: string;
  date: string;
  kind: string;
  slug: string;
  summary: string;
  commit: string;
  base: string;
  tarball: string;
  force: boolean;
  allowEmpty: boolean;
  help: boolean;
  json: boolean;
}

const VALUE_FLAGS = new Set(['--root', '--version', '--date', '--kind', '--slug', '--summary', '--commit', '--base', '--tarball']);
const VALUE_KEYS: Record<string, keyof ParsedArgs> = {
  '--root': 'rootDir',
  '--version': 'version',
  '--date': 'date',
  '--kind': 'kind',
  '--slug': 'slug',
  '--summary': 'summary',
  '--commit': 'commit',
  '--base': 'base',
  '--tarball': 'tarball',
};

const VERBS = new Set(['note', 'notes', 'bump', 'publish', 'cut', 'check', 'hygiene', 'verify-bins']);

export function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    verb: '',
    rootDir: undefined,
    version: '',
    date: '',
    kind: '',
    slug: '',
    summary: '',
    commit: '',
    base: '',
    tarball: '',
    force: false,
    allowEmpty: false,
    help: false,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (VALUE_FLAGS.has(arg) && next !== undefined) {
      const key = VALUE_KEYS[arg];
      (parsed as unknown as Record<string, string>)[key] = arg === '--root' ? path.resolve(next) : String(next).trim();
      index += 1;
    } else if (arg === '--force') {
      parsed.force = true;
    } else if (arg === '--allow-empty') {
      parsed.allowEmpty = true;
    } else if (arg === '--json') {
      parsed.json = true;
    } else if (!parsed.verb && !arg.startsWith('-')) {
      parsed.verb = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function loadConfigFromFile(rootDir: string): ReleaseKitConfig {
  const candidates = ['release-kit.config.js', 'release-kit.config.cjs'];
  for (const candidate of candidates) {
    const configPath = path.join(rootDir, candidate);
    if (fs.existsSync(configPath)) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const loaded = require(configPath) as ReleaseKitConfig | { default: ReleaseKitConfig };
      return 'default' in loaded ? (loaded as { default: ReleaseKitConfig }).default : (loaded as ReleaseKitConfig);
    }
  }
  throw new Error(
    `No release-kit.config.js (or .cjs) found in ${rootDir}. Create one that exports a ReleaseKitConfig (see defineConfig).`,
  );
}

function writeHelp(stream: NodeJS.WritableStream): void {
  stream.write(
    [
      'Usage: release-kit <command> [options]',
      '',
      'Commands:',
      '  note --kind <id> --slug <slug> --summary <text>   Create a new unreleased fragment',
      '  notes                                              Preview the release note for the current version',
      '  bump [--version <v>]                               Bump the manifest version',
      '  publish [--version <v>] [--force] [--allow-empty]  Publish fragments into a release file',
      '  cut [--version <v>] [--force] [--allow-empty]      Bump, publish, and validate in one step',
      '  check [--version <v>]                              Validate the current release state',
      '  hygiene [--base <ref>]                             Check release-relevant changes have a patch note',
      '  verify-bins [--tarball <path>]                     Assert every package.json#bin is executable in the packed tarball',
      '',
      'Options:',
      '  --root <dir>       Repo root (default: cwd, or the loaded config\'s rootDir)',
      '  --version <v>      Explicit version (default: resolved from the manifest / next version)',
      '  --date <date>      Release date (default: today, ISO 8601)',
      '  --commit <sha>     Commit to record in the release note',
      '  --kind <id>        Fragment kind (for `note`)',
      '  --slug <slug>      Fragment slug (for `note`)',
      '  --summary <text>   Fragment summary (for `note`)',
      '  --base <ref>       Base ref to diff against (for `hygiene`)',
      '  --tarball <path>   Pre-packed tarball to check (for `verify-bins`)',
      '  --force            Overwrite an existing release file',
      '  --allow-empty      Allow publishing/cutting with no fragments',
      '  --json             Emit validated ReleaseArtifactV1 for publish/cut',
      '  --help, -h          Show this help',
      '',
    ].join('\n'),
  );
}

export interface CliRunOptions {
  cwd?: string;
  /** Bypass config-file loading (mainly for tests / programmatic use). */
  config?: ReleaseKitConfig;
}

export function run(
  argv: string[] = process.argv.slice(2),
  stdout: NodeJS.WritableStream = process.stdout,
  stderr: NodeJS.WritableStream = process.stderr,
  options: CliRunOptions = {},
): number {
  // NOTE: parsing/business-logic errors are intentionally left to propagate
  // (thrown), matching rouge's original scripts exactly — `run()` itself has
  // no top-level try/catch; only the `require.main === module` bin entry
  // point below catches and converts to a clean exit code. A caller that
  // requires this module and calls `run()` programmatically sees the same
  // thrown-error behavior rouge's own scripts have always had.
  const parsed = parseArgs(argv);

  if (parsed.help || !parsed.verb) {
    writeHelp(stdout);
    return 0;
  }

  if (!VERBS.has(parsed.verb)) {
    stderr.write(`Unknown command: ${parsed.verb}\n`);
    writeHelp(stderr);
    return 1;
  }

  let config: ReleaseKitConfig;
  try {
    const cwd = options.cwd || process.cwd();
    const baseConfig = options.config || loadConfigFromFile(parsed.rootDir || cwd);
    config = parsed.rootDir ? { ...baseConfig, rootDir: parsed.rootDir } : baseConfig;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  const rootDir = path.resolve(config.rootDir);

  switch (parsed.verb) {
    case 'note': {
      const filePath = writeNewFragment(config, { kind: parsed.kind, slug: parsed.slug, summary: parsed.summary });
      stdout.write(`Created ${path.relative(rootDir, filePath)}\n`);
      return 0;
    }
    case 'notes': {
      const version = resolveVersion(config, parsed.version);
      config.versionStrategy.assert(version);
      stdout.write(
        renderReleaseNote(config, {
          version,
          date: parsed.date || todayIso(),
          fragments: collectFragments(config),
          commit: parsed.commit || getGitShortSha(rootDir),
        }),
      );
      return 0;
    }
    case 'bump': {
      const result = bumpVersion(config, { version: parsed.version });
      stdout.write(`Bumped ${config.versionLabel.toLowerCase()} ${result.previousVersion} -> ${result.version}\n`);
      return 0;
    }
    case 'publish': {
      const result = publishRelease(config, {
        version: parsed.version,
        date: parsed.date,
        commit: parsed.commit,
        force: parsed.force,
        allowEmpty: parsed.allowEmpty,
      });
      if (parsed.json) stdout.write(`${JSON.stringify(createReleaseArtifactV1(config, result, parsed.commit), null, 2)}\n`);
      else stdout.write(`Published ${path.relative(rootDir, result.releasePath)} from ${result.fragmentCount} fragment(s).\n`);
      return 0;
    }
    case 'cut': {
      const result = cutRelease(config, {
        version: parsed.version,
        date: parsed.date,
        commit: parsed.commit,
        force: parsed.force,
        allowEmpty: parsed.allowEmpty,
      });
      if (parsed.json) stdout.write(`${JSON.stringify(createReleaseArtifactV1(config, result, parsed.commit), null, 2)}\n`);
      else {
        stdout.write(`Cut ${result.previousVersion} -> ${result.version}\n`);
        stdout.write(`Published ${path.relative(rootDir, result.releasePath)} from ${result.fragmentCount} fragment(s).\n`);
      }
      return 0;
    }
    case 'check': {
      const version = resolveVersion(config, parsed.version);
      const result = validateReleaseState(config, version);
      if (!result.ok) {
        for (const error of result.errors) {
          stderr.write(`release:check: ${error}\n`);
        }
        return 1;
      }
      stdout.write(`release:check: ${version} is ready.\n`);
      return 0;
    }
    case 'hygiene': {
      const result = checkReleaseHygiene(config, { baseRef: parsed.base || config.hygiene.baseRef });
      if (result.ok) {
        if (result.relevantFiles.length === 0) {
          stdout.write('release:hygiene: ok - no release-relevant changes detected.\n');
        } else {
          stdout.write(
            `release:hygiene: ok - patch-note coverage found for ${result.relevantFiles.length} release-relevant file(s).\n`,
          );
        }
        return 0;
      }
      stderr.write('release:hygiene: release-relevant changes need a patch-note artifact.\n');
      stderr.write('Release-relevant files:\n');
      for (const file of result.relevantFiles) {
        stderr.write(`  - ${file}\n`);
      }
      stderr.write('\nAdd an unreleased fragment, for example:\n');
      stderr.write(`  ${config.hygiene.noteCommandHelp}\n`);
      stderr.write(
        `\nFor release branches, run \`${config.hygiene.publishCommandHelp}\` so a versioned release note changes with the branch.\n`,
      );
      return 1;
    }
    case 'verify-bins': {
      // This check reads POSIX permission bits out of the packed tarball.
      // Windows filesystems do not carry an executable bit, so `npm pack`
      // records 644 for every entry and the check condemns bins that are
      // correctly 100755 in git and executable for anyone on Linux or macOS.
      // A guaranteed false failure is worse than no signal, so skip and say
      // so. The check stays authoritative wherever a release is actually cut.
      if (process.platform === 'win32') {
        stdout.write(
          'release:verify-bins: skipped on Windows - NTFS carries no executable bit, so every packed entry reads as 644 here. Run this on Linux or macOS before publishing.\n',
        );
        return 0;
      }
      const result = verifyPackedBins({ rootDir, tarballPath: parsed.tarball });
      if (!result.ok) {
        stderr.write(`${formatPackedBinFailures(result)}\n`);
        return 1;
      }
      if (result.findings.length === 0) {
        stdout.write('release:verify-bins: ok - no bins declared.\n');
      } else {
        for (const finding of result.findings) {
          stdout.write(`release:verify-bins: ok - ${finding.name} (${finding.entry}) is executable.\n`);
        }
      }
      return 0;
    }
    default:
      return 1;
  }
}

/* istanbul ignore next -- exercised via the built dist/cli.js binary, not the TS source */
if (require.main === module) {
  try {
    process.exitCode = run();
  } catch (error) {
    console.error(error && (error as Error).message ? (error as Error).message : error);
    process.exitCode = 1;
  }
}
