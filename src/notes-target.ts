/**
 * Notes-target seam: pluggable policy for WHERE a version's release notes
 * get written and HOW their published state is validated. `patchNotesDirTarget`
 * is the DEFAULT and reproduces rouge's current per-version-file + index
 * behavior byte-for-byte (extracted, not rewritten, from `publish.ts`).
 * `changelogTarget` is the new flat-`CHANGELOG.md` target for consumers whose
 * CI greps `^## <version>`.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ReleaseKitConfig } from './config';
import { releaseLinkPath, resolvePaths } from './config';
import type { Fragment } from './fragments';
import { parseReleaseSummary, renderReleaseNote } from './render';
import { listReleaseSummaries, tryStep, updatePatchNotesIndex } from './publish';
import { combineRestores, snapshotFile } from './fs-snapshot';
import type { Restore } from './fs-snapshot';

export interface ReleaseNotesPublishContext {
  version: string;
  date: string;
  commit: string;
  fragments: Fragment[];
}

export interface ReleaseNotesTarget {
  /** Write the version's notes into the target and consume its fragments. Returns the written file path. */
  publish(
    config: ReleaseKitConfig,
    ctx: ReleaseNotesPublishContext,
    options: { force?: boolean },
  ): { releasePath: string };
  /** Return validation error strings for the target's state at `version` (empty array = ok). */
  validate(config: ReleaseKitConfig, version: string): string[];
  /** Returns whether `version`'s notes already exist in the target (checked pre-mutation by `preflightCut`). */
  hasVersion(config: ReleaseKitConfig, version: string): boolean;
  /**
   * Optional rollback support, mirroring `VersionManifestAdapter.snapshot`.
   * Snapshots every file `publish(config, ctx, ...)` would touch for this
   * `ctx` (the output file/index AND the fragment files `ctx.fragments`
   * names, which `publish` moves from `unreleased/` into `archive/<version>/`)
   * and returns a function that restores them all byte-for-byte, including
   * putting moved fragments back at their original location. `cutRelease`
   * calls this BEFORE `publish` and invokes the returned function if a later
   * step fails. Both built-in targets implement it; a custom target that
   * doesn't is skipped by `cutRelease` — best effort, not required.
   */
  snapshot?(config: ReleaseKitConfig, ctx: ReleaseNotesPublishContext): () => void;
}

/** Archives consumed fragments to `archiveDir/<version>/` and deletes them from `unreleased/`. Shared by both targets. */
function archiveConsumedFragments(config: ReleaseKitConfig, version: string, fragments: Fragment[]): void {
  if (fragments.length === 0) {
    return;
  }
  const paths = resolvePaths(config);
  const archiveVersionDir = path.join(paths.archiveDir, version);
  fs.mkdirSync(archiveVersionDir, { recursive: true });
  for (const fragment of fragments) {
    fs.copyFileSync(fragment.filePath, path.join(archiveVersionDir, fragment.fileName));
    fs.rmSync(fragment.filePath);
  }
}

/**
 * Snapshots what `archiveConsumedFragments` is about to do for `fragments`:
 * each fragment's ORIGINAL location under `unreleased/` (so a rollback moves
 * it back, not just re-creates a copy) and its future archive-copy
 * destination (so a rollback removes a partially-written copy rather than
 * leaving it behind). Also removes the `archiveDir/<version>/` directory on
 * rollback if this snapshot is the one that would have created it and it
 * ends up empty — an empty leftover directory isn't a content change (git
 * doesn't track empty dirs), so a failure tidying it up never masks the
 * file-level restore above it.
 */
function snapshotArchivedFragments(archiveVersionDir: string, fragments: Fragment[]): Restore {
  if (fragments.length === 0) {
    return () => {};
  }
  const archiveDirExisted = fs.existsSync(archiveVersionDir);
  const restoreFiles = combineRestores([
    ...fragments.map((fragment) => snapshotFile(fragment.filePath)),
    ...fragments.map((fragment) => snapshotFile(path.join(archiveVersionDir, fragment.fileName))),
  ]);
  return () => {
    restoreFiles();
    if (!archiveDirExisted) {
      try {
        if (fs.existsSync(archiveVersionDir) && fs.readdirSync(archiveVersionDir).length === 0) {
          fs.rmdirSync(archiveVersionDir);
        }
      } catch {
        // Best-effort tidy-up only — see doc comment above.
      }
    }
  };
}

function validateReleaseFile(
  config: ReleaseKitConfig,
  errors: string[],
  rootDir: string,
  releasePath: string,
  expectedVersion: string,
): void {
  const release = tryStep(errors, () => parseReleaseSummary(config, releasePath), null);
  if (!release) {
    return;
  }
  const relativePath = path.relative(rootDir, releasePath);
  if (release.titleVersion !== expectedVersion) {
    errors.push(`${relativePath} title version ${release.titleVersion || '(missing)'} does not match ${expectedVersion}.`);
  }
  if (release.packageVersion !== expectedVersion) {
    errors.push(`${relativePath} package version ${release.packageVersion || '(missing)'} does not match ${expectedVersion}.`);
  }
  if (release.stage.toLowerCase() !== config.stage.toLowerCase()) {
    errors.push(`${relativePath} stage ${release.stage || '(missing)'} must be ${config.stage}.`);
  }
  if (!release.date) {
    errors.push(`${relativePath} is missing a release date.`);
  }
}

/**
 * DEFAULT target: rouge's current behavior — a `releases/<version>.md` file
 * per version plus a generated `PATCH_NOTES.md` index. Byte-identical to the
 * pre-seam `publishRelease`/`validateReleaseState` bodies; see
 * `golden.test.ts` / `rouge-real-files.test.ts`.
 */
export function patchNotesDirTarget(): ReleaseNotesTarget {
  return {
    publish(config, ctx, options) {
      const paths = resolvePaths(config);
      fs.mkdirSync(paths.releasesDir, { recursive: true });
      const releasePath = path.join(paths.releasesDir, config.versionStrategy.releaseFileName(ctx.version));
      if (fs.existsSync(releasePath) && !options.force) {
        throw new Error(`${path.relative(paths.rootDir, releasePath)} already exists. Re-run with --force to overwrite it.`);
      }
      fs.writeFileSync(
        releasePath,
        renderReleaseNote(config, { version: ctx.version, date: ctx.date, fragments: ctx.fragments, commit: ctx.commit }),
        'utf8',
      );
      archiveConsumedFragments(config, ctx.version, ctx.fragments);
      updatePatchNotesIndex(config, ctx.version);
      return { releasePath };
    },

    hasVersion(config, version) {
      const { releasesDir } = resolvePaths(config);
      return fs.existsSync(path.join(releasesDir, config.versionStrategy.releaseFileName(version)));
    },

    snapshot(config, ctx) {
      const paths = resolvePaths(config);
      const releasePath = path.join(paths.releasesDir, config.versionStrategy.releaseFileName(ctx.version));
      const archiveVersionDir = path.join(paths.archiveDir, ctx.version);
      return combineRestores([
        snapshotFile(releasePath),
        snapshotFile(paths.indexPath),
        snapshotArchivedFragments(archiveVersionDir, ctx.fragments),
      ]);
    },

    validate(config, version) {
      const errors: string[] = [];
      const rootDir = path.resolve(config.rootDir);
      const { releasesDir, indexPath } = resolvePaths(config);
      // Best-effort filename for path construction only; an invalid version is
      // reported by the generic version-strategy assert in validateReleaseState,
      // so this never emits a second error.
      let currentReleaseFileName = `${version}.md`;
      try {
        currentReleaseFileName = config.versionStrategy.releaseFileName(version);
      } catch {
        // reported above
      }
      const currentReleasePath = path.join(releasesDir, currentReleaseFileName);
      if (version && !fs.existsSync(currentReleasePath)) {
        errors.push(`Current version ${version} has no published patch note at ${path.relative(rootDir, currentReleasePath)}.`);
      } else if (version) {
        validateReleaseFile(config, errors, rootDir, currentReleasePath, version);
      }
      if (!fs.existsSync(indexPath)) {
        errors.push(`Missing patch-note index: ${path.relative(rootDir, indexPath)}.`);
      } else {
        const indexSource = fs.readFileSync(indexPath, 'utf8');
        if (version && !indexSource.includes(`${config.currentVersionLabel}: \`${version}\``)) {
          errors.push(`Patch-note index does not list ${config.currentVersionLabel.toLowerCase()} ${version}.`);
        }
        if (!indexSource.includes('<!-- patch-notes:start -->') || !indexSource.includes('<!-- patch-notes:end -->')) {
          errors.push('Patch-note index is missing generated release markers.');
        }
        const expectedLink = `[${version}](${releaseLinkPath(config, currentReleaseFileName)})`;
        if (version && !indexSource.includes(expectedLink)) {
          errors.push(`Patch-note index does not link to ${config.paths.notesDir}/releases/${currentReleaseFileName}.`);
        }
      }
      for (const release of listReleaseSummaries(config)) {
        tryStep(
          errors,
          () => config.versionStrategy.assert(release.version),
          undefined,
          `${config.paths.notesDir}/releases/${release.fileName}: `,
        );
        if (!release.titleVersion) {
          errors.push(`${config.paths.notesDir}/releases/${release.fileName} is missing the standard patch-note title.`);
        }
        if (release.packageVersion && release.packageVersion !== release.version) {
          errors.push(
            `${config.paths.notesDir}/releases/${release.fileName} package version ${release.packageVersion} does not match title version ${release.version}.`,
          );
        }
      }
      return errors;
    },
  };
}

export interface ChangelogTargetOptions {
  /** Relative (POSIX-style) path to the changelog file, resolved against `config.rootDir`. Default: `"CHANGELOG.md"`. */
  changelogPath?: string;
  /** Title written as `# <title>` when the file doesn't exist yet. Default: `"Changelog"`. */
  title?: string;
  /** When `true`, emit `### <kind heading>` subsections under each version. Default: `false` (flat bullet list). */
  groupByKind?: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Stable sort by `config.kinds` order; fragments whose kind isn't in `config.kinds` sort last. */
function sortFragmentsByKindOrder(config: ReleaseKitConfig, fragments: Fragment[]): Fragment[] {
  const orderOf = (kind: string): number => {
    const index = config.kinds.findIndex((kindDef) => kindDef.id === kind);
    return index === -1 ? config.kinds.length : index;
  };
  return fragments
    .map((fragment, index) => ({ fragment, index, order: orderOf(fragment.kind) }))
    .sort((a, b) => (a.order === b.order ? a.index - b.index : a.order - b.order))
    .map((entry) => entry.fragment);
}

/** `- <summary>` plus the raw fragment body (if non-empty) as an indented continuation. */
function renderFlatBullets(fragments: Fragment[]): string[] {
  const lines: string[] = [];
  for (const fragment of fragments) {
    lines.push(`- ${fragment.summary}`);
    const body = fragment.body.trim();
    if (body) {
      for (const bodyLine of body.split('\n')) {
        lines.push(`  ${bodyLine}`);
      }
    }
  }
  return lines;
}

function renderChangelogSection(config: ReleaseKitConfig, ctx: ReleaseNotesPublishContext, groupByKind: boolean): string {
  const ordered = sortFragmentsByKindOrder(config, ctx.fragments);
  const lines: string[] = [`## ${ctx.version}`, ''];
  if (ordered.length === 0) {
    lines.push('_No changes recorded for this release._');
  } else if (!groupByKind) {
    lines.push(...renderFlatBullets(ordered));
  } else {
    for (const kindDef of config.kinds) {
      const group = ordered.filter((fragment) => fragment.kind === kindDef.id);
      if (group.length === 0) {
        continue;
      }
      lines.push(`### ${kindDef.heading}`, '', ...renderFlatBullets(group), '');
    }
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n\n`;
}

/** Matches a full semver heading line (`## X.Y.Z`, optional `-prerelease` and `+build`), not a mere digit-led `## ` heading. */
const SEMVER_HEADING_RE = /^## \d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?\s*$/m;

/** Bounded exact-version heading matcher, e.g. `^## 1.2.3 *$`, shared by the force-check, `hasVersion`, and `validate`. */
function versionHeadingRegex(version: string): RegExp {
  return new RegExp(`^## ${escapeRegExp(version)} *$`, 'm');
}

/** Index (into `text`) of the line just after the section starting at `headingIndex` — i.e. the next `^## ` heading, or `text.length`. */
function sectionEnd(text: string, headingIndex: number): number {
  const rest = text.slice(headingIndex);
  const firstLineBreak = rest.indexOf('\n');
  const searchFrom = firstLineBreak === -1 ? rest.length : firstLineBreak + 1;
  const nextHeadingMatch = /^## /m.exec(rest.slice(searchFrom));
  return nextHeadingMatch ? headingIndex + searchFrom + nextHeadingMatch.index : text.length;
}

/**
 * NEW target: a single flat `CHANGELOG.md` with `## X.Y.Z` version sections —
 * the invariant a fleet `release-guard` checks with `^## <version>`.
 */
export function changelogTarget(options: ChangelogTargetOptions = {}): ReleaseNotesTarget {
  const changelogRelPath = options.changelogPath ?? 'CHANGELOG.md';
  const title = options.title ?? 'Changelog';
  const groupByKind = options.groupByKind ?? false;

  return {
    publish(config, ctx, publishOptions) {
      const rootDir = path.resolve(config.rootDir);
      const changelogPath = path.join(rootDir, changelogRelPath);
      const existing = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, 'utf8') : `# ${title}\n`;
      const section = renderChangelogSection(config, ctx, groupByKind);

      const existingMatch = versionHeadingRegex(ctx.version).exec(existing);
      // Only the two seams (end of `head`, and the file's final trailing
      // newline) are normalized below; `head` and `tail` themselves are
      // spliced in verbatim so unrelated sections keep their exact bytes.
      let nextContent: string;
      if (existingMatch) {
        if (!publishOptions.force) {
          throw new Error(`CHANGELOG already has a ## ${ctx.version} section; re-run with force to overwrite.`);
        }
        const start = existingMatch.index;
        const end = sectionEnd(existing, start);
        const head = existing.slice(0, start).replace(/\n+$/, '');
        const tail = existing.slice(end);
        nextContent = head.length > 0 ? `${head}\n\n${section}${tail}` : `${section}${tail}`;
      } else {
        const semverHeadingMatch = SEMVER_HEADING_RE.exec(existing);
        if (semverHeadingMatch) {
          const head = existing.slice(0, semverHeadingMatch.index).replace(/\n+$/, '');
          const tail = existing.slice(semverHeadingMatch.index);
          nextContent = head.length > 0 ? `${head}\n\n${section}${tail}` : `${section}${tail}`;
        } else {
          const preamble = existing.trimEnd();
          nextContent = preamble.length > 0 ? `${preamble}\n\n${section}` : section;
        }
      }
      nextContent = `${nextContent.replace(/\n+$/, '')}\n`;

      fs.mkdirSync(path.dirname(changelogPath), { recursive: true });
      fs.writeFileSync(changelogPath, nextContent, 'utf8');
      archiveConsumedFragments(config, ctx.version, ctx.fragments);
      return { releasePath: changelogPath };
    },

    hasVersion(config, version) {
      const rootDir = path.resolve(config.rootDir);
      const changelogPath = path.join(rootDir, changelogRelPath);
      if (!fs.existsSync(changelogPath)) {
        return false;
      }
      const source = fs.readFileSync(changelogPath, 'utf8');
      return versionHeadingRegex(version).test(source);
    },

    snapshot(config, ctx) {
      const rootDir = path.resolve(config.rootDir);
      const changelogPath = path.join(rootDir, changelogRelPath);
      const archiveVersionDir = path.join(resolvePaths(config).archiveDir, ctx.version);
      return combineRestores([snapshotFile(changelogPath), snapshotArchivedFragments(archiveVersionDir, ctx.fragments)]);
    },

    validate(config, version) {
      const rootDir = path.resolve(config.rootDir);
      const changelogPath = path.join(rootDir, changelogRelPath);
      if (!fs.existsSync(changelogPath)) {
        return [`Missing changelog: ${path.relative(rootDir, changelogPath)}.`];
      }
      const source = fs.readFileSync(changelogPath, 'utf8');
      if (!versionHeadingRegex(version).test(source)) {
        return [`${path.relative(rootDir, changelogPath)} is missing a "## ${version}" heading.`];
      }
      return [];
    },
  };
}
