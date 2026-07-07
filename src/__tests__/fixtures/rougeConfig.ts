// Test-only fixture: a ReleaseKitConfig that reproduces rouge's ACTUAL
// current config values byte-for-byte (see rouge's
// scripts/lib/release-notes-core.js and scripts/check-release-hygiene.js).
// Used by the ported safety-net tests and the golden-parity test so the
// package's output can be diffed against rouge's real scripts.

import { alphaSemver } from '../../version';
import { npmPackage } from '../../manifest';
import type { ReleaseKitConfig } from '../../config';

export function makeRougeConfig(rootDir: string): ReleaseKitConfig {
  return {
    productName: 'Angel Snack',
    stage: 'alpha',
    rootDir,
    paths: {
      notesDir: 'docs/patch-notes',
      indexPath: 'docs/PATCH_NOTES.md',
    },
    kinds: [
      { id: 'highlight', heading: 'Highlights' },
      { id: 'gameplay', heading: 'Gameplay' },
      { id: 'balance', heading: 'Balance' },
      { id: 'content', heading: 'Content' },
      { id: 'ui', heading: 'UI' },
      { id: 'fix', heading: 'Fixes' },
      { id: 'tech', heading: 'Tech' },
      { id: 'ops', heading: 'Operations' },
    ],
    versionStrategy: alphaSemver({ versionLabel: 'Game version' }),
    manifest: npmPackage(),
    hygiene: {
      baseRef: 'origin/master',
      relevantPrefixes: [
        'assets/audio/',
        'assets/curated/',
        'boot/',
        'config/',
        'data/',
        'desktop/',
        'packages/',
        'prisma/',
        'src/',
        'styles/',
        'vendor/',
      ],
      relevantFiles: [
        'AGENTS.md',
        'index.html',
        'package-lock.json',
        'package.json',
        'scripts/build.js',
        'scripts/check-mac-release-env.js',
        'scripts/check-release-hygiene.js',
        'scripts/cut-release.js',
        'scripts/deploy.sh',
        'scripts/ensure-production-env.js',
        'scripts/lib/patch-notes-site.js',
        'scripts/release-notes.js',
        'scripts/update-server-version.js',
      ],
      relevantScriptPrefixes: [
        'scripts/lib/release-notes-',
        'scripts/migrations/',
        'scripts/tools/routes/',
        'scripts/tools/start-static',
        'scripts/tools/maintenance-flag',
      ],
      relevantDocFiles: [
        'docs/PATCH_NOTES.md',
        'docs/ops/RELEASE_ASSISTANT_PLAN.md',
        'docs/ops/RELEASE_PROCESS.md',
        'docs/patch-notes/README.md',
        'docs/patch-notes/unreleased/README.md',
      ],
      noteCommandHelp: 'npm run release:note -- --kind gameplay --slug short-slug --summary "Player-facing summary"',
      publishCommandHelp: 'npm run release:publish',
    },
    titleTemplate: '# {productName} {version} Patch Notes',
    versionLabel: 'Game version',
    currentVersionLabel: 'Current game version',
    fragmentBodyPlaceholder: 'Describe the player-facing impact in one short paragraph before publishing.',
    releaseNoteIntroTemplate: 'These notes are gathered from the release fragments in `{notesDir}/unreleased/`.',
    indexIntroTemplate: 'Patch notes are gathered from `{notesDir}/unreleased/*.md` and published with `{publishCommand}`.',
  };
}
