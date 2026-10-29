import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GIT_INSTALL_TRIGGERS, validateReleaseState } from '../publish';
import { changelogTarget } from '../notes-target';
import { stableSemver } from '../version';
import { npmPackage } from '../manifest';
import type { ReleaseKitConfig } from '../config';

function makeConfig(manifest: Record<string, unknown>, installFromGit: boolean | undefined): ReleaseKitConfig {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-kit-git-install-'));
  fs.writeFileSync(path.join(rootDir, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0', ...manifest }), 'utf8');
  fs.writeFileSync(path.join(rootDir, 'CHANGELOG.md'), '# Changelog\n\n## 1.0.0\n\n- Initial.\n', 'utf8');
  return {
    productName: 'X',
    stage: 'stable',
    rootDir,
    paths: { notesDir: '.changes', indexPath: '.changes/INDEX.md' },
    kinds: [{ id: 'fixed', heading: 'Fixed' }],
    versionStrategy: stableSemver(),
    manifest: npmPackage(),
    notesTarget: changelogTarget(),
    hygiene: { baseRef: 'origin/master', relevantPrefixes: [], relevantFiles: [], relevantScriptPrefixes: [], relevantDocFiles: [], noteCommandHelp: '', publishCommandHelp: '' },
    titleTemplate: '# {productName} {version}',
    versionLabel: 'Package version',
    currentVersionLabel: 'Current package version',
    fragmentBodyPlaceholder: 'x',
    releaseNoteIntroTemplate: '',
    indexIntroTemplate: '',
    installFromGit,
  };
}

const gitErrors = (config: ReleaseKitConfig) => validateReleaseState(config).errors.filter((e) => e.includes('installed from git'));

describe('installFromGit release:check rule', () => {
  test('a package with no trigger keys passes', () => {
    expect(gitErrors(makeConfig({ scripts: { compile: 'tsc', test: 'vitest' } }, true))).toEqual([]);
  });

  test.each(GIT_INSTALL_TRIGGERS)('scripts.%s fails by name', (name) => {
    const errors = gitErrors(makeConfig({ scripts: { [name]: 'echo' } }, true));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(`package.json scripts.${name} makes npm install every dependency`);
  });

  test('a workspaces field fails by name', () => {
    const errors = gitErrors(makeConfig({ workspaces: ['packages/*'] }, true));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('package.json workspaces');
  });

  test('each offending key is reported separately', () => {
    expect(gitErrors(makeConfig({ scripts: { prepare: 'x', build: 'y' } }, true))).toHaveLength(2);
  });

  test.each([undefined, false])('option %s ignores trigger keys', (flag) => {
    expect(gitErrors(makeConfig({ scripts: { prepare: 'x', build: 'y' }, workspaces: ['a'] }, flag))).toEqual([]);
  });
});
