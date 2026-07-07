"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../..");
const RELEASE_KIND_DEFS = [
  { id: "highlight", heading: "Highlights" },
  { id: "gameplay", heading: "Gameplay" },
  { id: "balance", heading: "Balance" },
  { id: "content", heading: "Content" },
  { id: "ui", heading: "UI" },
  { id: "fix", heading: "Fixes" },
  { id: "tech", heading: "Tech" },
  { id: "ops", heading: "Operations" },
];
const RELEASE_KIND_IDS = new Set(RELEASE_KIND_DEFS.map((kind) => kind.id));
const ALPHA_VERSION_RE = /^(\d+)\.(\d+)\.(\d+)-alpha\.(\d+)$/;

function resolvePaths(rootDir) {
  const docsDir = path.join(rootDir, "docs");
  const notesDir = path.join(docsDir, "patch-notes");
  return {
    docsDir,
    notesDir,
    unreleasedDir: path.join(notesDir, "unreleased"),
    releasesDir: path.join(notesDir, "releases"),
    archiveDir: path.join(notesDir, "archive"),
    indexPath: path.join(docsDir, "PATCH_NOTES.md"),
    packagePath: path.join(rootDir, "package.json"),
    packageLockPath: path.join(rootDir, "package-lock.json"),
  };
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readPackageVersion(rootDir) {
  const pkg = readJsonFile(resolvePaths(rootDir).packagePath);
  return String(pkg.version || "").trim();
}

function resolveVersion(rootDir, explicitVersion) {
  return String(explicitVersion || readPackageVersion(rootDir)).trim();
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function assertAlphaVersion(version) {
  if (!ALPHA_VERSION_RE.test(String(version || ""))) {
    throw new Error(`Game version "${version}" must use alpha semver, for example 0.1.0-alpha.0.`);
  }
}

function releaseFileName(version) {
  assertAlphaVersion(version);
  return `${version}.md`;
}

function nextAlphaVersion(version) {
  const match = String(version || "").match(ALPHA_VERSION_RE);
  if (!match) {
    assertAlphaVersion(version);
  }
  return `${match[1]}.${match[2]}.${match[3]}-alpha.${Number(match[4]) + 1}`;
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function parseFrontMatter(source, filePath = "<inline>") {
  const match = String(source || "").replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(`Patch-note fragment ${filePath} must start with YAML-style front matter.`);
  }
  const meta = {};
  for (const line of match[1].split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex === -1) {
      throw new Error(`Invalid front matter line in ${filePath}: ${line}`);
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");
    meta[key] = value;
  }
  return { meta, body: match[2].trim() };
}

function parseFragment(filePath, rootDir) {
  const { meta, body } = parseFrontMatter(fs.readFileSync(filePath, "utf8"), path.relative(rootDir, filePath));
  const kind = String(meta.kind || "").trim();
  const summary = String(meta.summary || meta.title || "").trim();
  if (!RELEASE_KIND_IDS.has(kind)) {
    throw new Error(`${path.relative(rootDir, filePath)} has kind "${kind}". Expected one of: ${[...RELEASE_KIND_IDS].join(", ")}.`);
  }
  if (!summary) {
    throw new Error(`${path.relative(rootDir, filePath)} is missing a summary.`);
  }
  if (!body) {
    throw new Error(`${path.relative(rootDir, filePath)} needs a short body paragraph.`);
  }
  return { filePath, fileName: path.basename(filePath), kind, summary, body };
}

function isFragmentFile(fileName) {
  return fileName.endsWith(".md") && fileName !== "README.md" && !fileName.startsWith("_");
}

function collectFragments(rootDir) {
  const { unreleasedDir } = resolvePaths(rootDir);
  if (!fs.existsSync(unreleasedDir)) {
    return [];
  }
  return fs.readdirSync(unreleasedDir)
    .filter(isFragmentFile)
    .sort((left, right) => left.localeCompare(right))
    .map((fileName) => parseFragment(path.join(unreleasedDir, fileName), rootDir))
    .sort((left, right) => {
      const leftKind = RELEASE_KIND_DEFS.findIndex((kind) => kind.id === left.kind);
      const rightKind = RELEASE_KIND_DEFS.findIndex((kind) => kind.id === right.kind);
      return leftKind === rightKind ? left.fileName.localeCompare(right.fileName) : leftKind - rightKind;
    });
}

function normalizeFragmentBody(body) {
  return String(body || "")
    .split("\n")
    .map((line) => line.trim().replace(/^-\s+/, ""))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function getGitShortSha(rootDir) {
  try {
    return String(execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    })).trim();
  } catch {
    return "";
  }
}

function renderReleaseNote({ version, date, fragments, commit = "" }) {
  assertAlphaVersion(version);
  const lines = [
    `# Angel Snack ${version} Patch Notes`,
    "",
    `Release date: ${date}`,
    "Stage: alpha",
    `Package version: ${version}`,
  ];
  if (commit) {
    lines.push(`Commit: ${commit}`);
  }
  lines.push("", "These notes are gathered from the release fragments in `docs/patch-notes/unreleased/`.", "");
  if (fragments.length === 0) {
    lines.push("_No patch-note fragments were collected for this release._", "");
    return `${lines.join("\n")}\n`;
  }
  for (const kindDef of RELEASE_KIND_DEFS) {
    const group = fragments.filter((fragment) => fragment.kind === kindDef.id);
    if (group.length === 0) {
      continue;
    }
    lines.push(`## ${kindDef.heading}`, "");
    for (const fragment of group) {
      lines.push(`- **${fragment.summary}:** ${normalizeFragmentBody(fragment.body)}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

function parseReleaseSummary(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const titleMatch = source.match(/^# Angel Snack ([^\s]+) Patch Notes/m);
  const dateMatch = source.match(/^Release date:\s*(.+)$/m);
  const stageMatch = source.match(/^Stage:\s*(.+)$/m);
  const packageVersionMatch = source.match(/^Package version:\s*(.+)$/m);
  return {
    titleVersion: titleMatch ? titleMatch[1] : "",
    version: titleMatch ? titleMatch[1] : path.basename(filePath, ".md"),
    date: dateMatch ? dateMatch[1].trim() : "",
    stage: stageMatch ? stageMatch[1].trim() : "",
    packageVersion: packageVersionMatch ? packageVersionMatch[1].trim() : "",
    fileName: path.basename(filePath),
  };
}

function compareAlphaVersionsDesc(left, right) {
  const leftMatch = String(left.version || "").match(ALPHA_VERSION_RE);
  const rightMatch = String(right.version || "").match(ALPHA_VERSION_RE);
  if (leftMatch && rightMatch) {
    for (let index = 1; index <= 4; index += 1) {
      const delta = Number(rightMatch[index]) - Number(leftMatch[index]);
      if (delta !== 0) {
        return delta;
      }
    }
  }
  return left.date !== right.date
    ? String(right.date || "").localeCompare(String(left.date || ""))
    : String(right.version || "").localeCompare(String(left.version || ""));
}

function listReleaseSummaries(rootDir) {
  const { releasesDir } = resolvePaths(rootDir);
  if (!fs.existsSync(releasesDir)) {
    return [];
  }
  return fs.readdirSync(releasesDir)
    .filter((fileName) => fileName.endsWith(".md") && fileName !== "README.md")
    .sort((left, right) => left.localeCompare(right))
    .map((fileName) => parseReleaseSummary(path.join(releasesDir, fileName)))
    .sort(compareAlphaVersionsDesc);
}

function renderPatchNotesIndex(rootDir, version) {
  const releases = listReleaseSummaries(rootDir);
  const lines = [
    "# Angel Snack Patch Notes",
    "",
    `Current game version: \`${version}\``,
    "",
    "Patch notes are gathered from `docs/patch-notes/unreleased/*.md` and published with `npm run release:publish`.",
    "",
    "<!-- patch-notes:start -->",
    "## Releases",
    "",
  ];
  if (releases.length === 0) {
    lines.push("_No published patch notes yet._");
  } else {
    for (const release of releases) {
      const date = release.date ? ` - ${release.date}` : "";
      lines.push(`- [${release.version}](patch-notes/releases/${release.fileName})${date}`);
    }
  }
  lines.push("<!-- patch-notes:end -->", "");
  return lines.join("\n");
}

function updatePatchNotesIndex(rootDir, version) {
  const { docsDir, indexPath } = resolvePaths(rootDir);
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(indexPath, renderPatchNotesIndex(rootDir, version), "utf8");
}

function publishRelease(options) {
  const rootDir = path.resolve(options.rootDir || ROOT);
  const version = resolveVersion(rootDir, options.version);
  const date = options.date || todayIso();
  assertAlphaVersion(version);
  const paths = resolvePaths(rootDir);
  fs.mkdirSync(paths.releasesDir, { recursive: true });
  fs.mkdirSync(paths.archiveDir, { recursive: true });
  fs.mkdirSync(paths.unreleasedDir, { recursive: true });
  const fragments = collectFragments(rootDir);
  if (fragments.length === 0 && !options.allowEmpty) {
    throw new Error("No unreleased patch-note fragments found. Use --allow-empty to publish an empty note.");
  }
  const releasePath = path.join(paths.releasesDir, releaseFileName(version));
  if (fs.existsSync(releasePath) && !options.force) {
    throw new Error(`${path.relative(rootDir, releasePath)} already exists. Re-run with --force to overwrite it.`);
  }
  fs.writeFileSync(releasePath, renderReleaseNote({
    version,
    date,
    fragments,
    commit: String(options.commit || ""),
  }), "utf8");
  if (fragments.length > 0) {
    const archiveVersionDir = path.join(paths.archiveDir, version);
    fs.mkdirSync(archiveVersionDir, { recursive: true });
    for (const fragment of fragments) {
      fs.copyFileSync(fragment.filePath, path.join(archiveVersionDir, fragment.fileName));
      fs.rmSync(fragment.filePath);
    }
  }
  updatePatchNotesIndex(rootDir, version);
  return { version, releasePath, fragmentCount: fragments.length };
}

function readPackageLockVersions(rootDir) {
  const lock = readJsonFile(resolvePaths(rootDir).packageLockPath);
  return {
    version: String(lock.version || "").trim(),
    rootPackageVersion: String(lock.packages?.[""]?.version || "").trim(),
  };
}

function writePackageVersions(rootDir, version) {
  assertAlphaVersion(version);
  const { packagePath, packageLockPath } = resolvePaths(rootDir);
  const pkg = readJsonFile(packagePath);
  const lock = readJsonFile(packageLockPath);
  pkg.version = version;
  lock.version = version;
  if (!lock.packages || typeof lock.packages !== "object" || Array.isArray(lock.packages) || !lock.packages[""]) {
    throw new Error("package-lock.json is missing packages[\"\"].version.");
  }
  lock.packages[""].version = version;
  writeJsonFile(packagePath, pkg);
  writeJsonFile(packageLockPath, lock);
}

function bumpAlphaVersion(options) {
  const rootDir = path.resolve(options.rootDir || ROOT);
  const previousVersion = readPackageVersion(rootDir);
  const version = String(options.version || nextAlphaVersion(previousVersion)).trim();
  writePackageVersions(rootDir, version);
  return { previousVersion, version };
}

function validatePackageLock(errors, rootDir, version) {
  const lockVersions = tryStep(errors, () => readPackageLockVersions(rootDir), null);
  if (!lockVersions) {
    return;
  }
  if (lockVersions.version !== version) {
    errors.push(`package-lock.json version ${lockVersions.version || "(missing)"} does not match package.json version ${version}.`);
  }
  if (lockVersions.rootPackageVersion !== version) {
    errors.push(`package-lock.json packages[""].version ${lockVersions.rootPackageVersion || "(missing)"} does not match package.json version ${version}.`);
  }
}

function validateReleaseFile(errors, rootDir, releasePath, expectedVersion) {
  const release = tryStep(errors, () => parseReleaseSummary(releasePath), null);
  if (!release) {
    return;
  }
  const relativePath = path.relative(rootDir, releasePath);
  if (release.titleVersion !== expectedVersion) {
    errors.push(`${relativePath} title version ${release.titleVersion || "(missing)"} does not match ${expectedVersion}.`);
  }
  if (release.packageVersion !== expectedVersion) {
    errors.push(`${relativePath} package version ${release.packageVersion || "(missing)"} does not match ${expectedVersion}.`);
  }
  if (release.stage.toLowerCase() !== "alpha") {
    errors.push(`${relativePath} stage ${release.stage || "(missing)"} must be alpha.`);
  }
  if (!release.date) {
    errors.push(`${relativePath} is missing a release date.`);
  }
}

function validateReleaseState(rootDir, explicitVersion = "") {
  const errors = [];
  const version = tryStep(errors, () => resolveVersion(rootDir, explicitVersion), "");
  if (version) {
    tryStep(errors, () => assertAlphaVersion(version));
    validatePackageLock(errors, rootDir, version);
  }
  tryStep(errors, () => collectFragments(rootDir));
  const { releasesDir, indexPath } = resolvePaths(rootDir);
  const currentReleasePath = path.join(releasesDir, `${version}.md`);
  if (version && !fs.existsSync(currentReleasePath)) {
    errors.push(`Current version ${version} has no published patch note at ${path.relative(rootDir, currentReleasePath)}.`);
  } else if (version) {
    validateReleaseFile(errors, rootDir, currentReleasePath, version);
  }
  if (!fs.existsSync(indexPath)) {
    errors.push(`Missing patch-note index: ${path.relative(rootDir, indexPath)}.`);
  } else {
    const indexSource = fs.readFileSync(indexPath, "utf8");
    if (version && !indexSource.includes(`Current game version: \`${version}\``)) {
      errors.push(`Patch-note index does not list current game version ${version}.`);
    }
    if (!indexSource.includes("<!-- patch-notes:start -->") || !indexSource.includes("<!-- patch-notes:end -->")) {
      errors.push("Patch-note index is missing generated release markers.");
    }
    if (version && !indexSource.includes(`[${version}](patch-notes/releases/${version}.md)`)) {
      errors.push(`Patch-note index does not link to docs/patch-notes/releases/${version}.md.`);
    }
  }
  for (const release of listReleaseSummaries(rootDir)) {
    tryStep(errors, () => assertAlphaVersion(release.version), null, `docs/patch-notes/releases/${release.fileName}: `);
    if (!release.titleVersion) {
      errors.push(`docs/patch-notes/releases/${release.fileName} is missing the standard patch-note title.`);
    }
    if (release.packageVersion && release.packageVersion !== release.version) {
      errors.push(`docs/patch-notes/releases/${release.fileName} package version ${release.packageVersion} does not match title version ${release.version}.`);
    }
  }
  return { ok: errors.length === 0, errors, version };
}

function tryStep(errors, fn, fallback = undefined, prefix = "") {
  try {
    return fn();
  } catch (error) {
    errors.push(`${prefix}${error.message}`);
    return fallback;
  }
}

function writeNewFragment(options) {
  const rootDir = path.resolve(options.rootDir || ROOT);
  const kind = String(options.kind || "highlight").trim();
  const slug = slugify(options.slug || options.summary);
  const summary = String(options.summary || "").trim();
  if (!RELEASE_KIND_IDS.has(kind)) {
    throw new Error(`Unknown kind "${kind}". Expected one of: ${[...RELEASE_KIND_IDS].join(", ")}.`);
  }
  if (!slug) {
    throw new Error("Missing --slug for the new patch-note fragment.");
  }
  if (!summary) {
    throw new Error("Missing --summary for the new patch-note fragment.");
  }
  const { unreleasedDir } = resolvePaths(rootDir);
  fs.mkdirSync(unreleasedDir, { recursive: true });
  const filePath = path.join(unreleasedDir, `${kind}-${slug}.md`);
  if (fs.existsSync(filePath)) {
    throw new Error(`${path.relative(rootDir, filePath)} already exists.`);
  }
  fs.writeFileSync(filePath, [
    "---",
    `kind: ${kind}`,
    `summary: ${summary}`,
    "---",
    "",
    "Describe the player-facing impact in one short paragraph before publishing.",
    "",
  ].join("\n"), "utf8");
  return filePath;
}

module.exports = {
  ALPHA_VERSION_RE,
  RELEASE_KIND_DEFS,
  assertAlphaVersion,
  bumpAlphaVersion,
  collectFragments,
  getGitShortSha,
  listReleaseSummaries,
  nextAlphaVersion,
  parseFrontMatter,
  publishRelease,
  renderPatchNotesIndex,
  renderReleaseNote,
  resolveVersion,
  slugify,
  todayIso,
  updatePatchNotesIndex,
  validateReleaseState,
  writeNewFragment,
};
