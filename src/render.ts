/**
 * Release-note and patch-notes-index rendering — ported byte-for-byte from
 * rouge's `scripts/lib/release-notes-core.js`. `renderReleaseNote` is pure
 * given fragments + an injected date/commit. The title line (and its
 * parser) are driven by `config.titleTemplate` so they can never drift.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ReleaseKitConfig } from './config';
import { applyTemplate, releaseLinkPath, renderTitle, titleRegExp } from './config';
import type { Fragment } from './fragments';
import { normalizeFragmentBody } from './fragments';

export interface ReleaseSummary {
  titleVersion: string;
  version: string;
  date: string;
  stage: string;
  packageVersion: string;
  fileName: string;
}

export interface RenderReleaseNoteOptions {
  version: string;
  date: string;
  fragments: Fragment[];
  commit?: string;
}

export function renderReleaseNote(config: ReleaseKitConfig, options: RenderReleaseNoteOptions): string {
  const { version, date, fragments, commit = '' } = options;
  config.versionStrategy.assert(version);
  const lines = [
    renderTitle(config, version),
    '',
    `Release date: ${date}`,
    `Stage: ${config.stage}`,
    `Package version: ${version}`,
  ];
  if (commit) {
    lines.push(`Commit: ${commit}`);
  }
  lines.push('', applyTemplate(config.releaseNoteIntroTemplate, { notesDir: config.paths.notesDir }), '');
  if (fragments.length === 0) {
    lines.push('_No patch-note fragments were collected for this release._', '');
    return `${lines.join('\n')}\n`;
  }
  for (const kindDef of config.kinds) {
    const group = fragments.filter((fragment) => fragment.kind === kindDef.id);
    if (group.length === 0) {
      continue;
    }
    lines.push(`## ${kindDef.heading}`, '');
    for (const fragment of group) {
      lines.push(`- **${fragment.summary}:** ${normalizeFragmentBody(fragment.body)}`);
    }
    lines.push('');
  }
  return `${lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`;
}

export function parseReleaseSummary(config: ReleaseKitConfig, filePath: string): ReleaseSummary {
  const source = fs.readFileSync(filePath, 'utf8');
  const titleMatch = source.match(titleRegExp(config));
  const dateMatch = source.match(/^Release date:\s*(.+)$/m);
  const stageMatch = source.match(/^Stage:\s*(.+)$/m);
  const packageVersionMatch = source.match(/^Package version:\s*(.+)$/m);
  return {
    titleVersion: titleMatch ? titleMatch[1] : '',
    version: titleMatch ? titleMatch[1] : path.basename(filePath, '.md'),
    date: dateMatch ? dateMatch[1].trim() : '',
    stage: stageMatch ? stageMatch[1].trim() : '',
    packageVersion: packageVersionMatch ? packageVersionMatch[1].trim() : '',
    fileName: path.basename(filePath),
  };
}

export function renderPatchNotesIndex(config: ReleaseKitConfig, releases: ReleaseSummary[], version: string): string {
  const lines = [
    `# ${config.productName} Patch Notes`,
    '',
    `${config.currentVersionLabel}: \`${version}\``,
    '',
    applyTemplate(config.indexIntroTemplate, {
      notesDir: config.paths.notesDir,
      publishCommand: config.hygiene.publishCommandHelp,
    }),
    '',
    '<!-- patch-notes:start -->',
    '## Releases',
    '',
  ];
  if (releases.length === 0) {
    lines.push('_No published patch notes yet._');
  } else {
    for (const release of releases) {
      const date = release.date ? ` - ${release.date}` : '';
      lines.push(`- [${release.version}](${releaseLinkPath(config, release.fileName)})${date}`);
    }
  }
  lines.push('<!-- patch-notes:end -->', '');
  return lines.join('\n');
}
