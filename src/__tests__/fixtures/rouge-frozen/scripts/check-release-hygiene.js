#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_BASE_REF = "origin/master";
const VALUE_FLAGS = new Set(["--root", "--base"]);
const VALUE_KEYS = {
  "--root": "rootDir",
  "--base": "baseRef",
};

const RELEASE_RELEVANT_PREFIXES = [
  "assets/audio/",
  "assets/curated/",
  "boot/",
  "config/",
  "data/",
  "desktop/",
  "packages/",
  "prisma/",
  "src/",
  "styles/",
  "vendor/",
];

const RELEASE_RELEVANT_FILES = new Set([
  "AGENTS.md",
  "index.html",
  "package-lock.json",
  "package.json",
  "scripts/build.js",
  "scripts/check-mac-release-env.js",
  "scripts/check-release-hygiene.js",
  "scripts/cut-release.js",
  "scripts/deploy.sh",
  "scripts/ensure-production-env.js",
  "scripts/lib/patch-notes-site.js",
  "scripts/release-notes.js",
  "scripts/update-server-version.js",
]);

const RELEASE_RELEVANT_SCRIPT_PREFIXES = [
  "scripts/lib/release-notes-",
  "scripts/migrations/",
  "scripts/tools/routes/",
  "scripts/tools/start-static",
  "scripts/tools/maintenance-flag",
];

const RELEASE_RELEVANT_DOC_FILES = new Set([
  "docs/PATCH_NOTES.md",
  "docs/ops/RELEASE_ASSISTANT_PLAN.md",
  "docs/ops/RELEASE_PROCESS.md",
  "docs/patch-notes/README.md",
  "docs/patch-notes/unreleased/README.md",
]);

function parseArgs(argv) {
  const parsed = {
    rootDir: ROOT,
    baseRef: DEFAULT_BASE_REF,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (VALUE_FLAGS.has(arg) && next) {
      parsed[VALUE_KEYS[arg]] = arg === "--root" ? path.resolve(next) : String(next).trim();
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function normalizePath(filePath) {
  return String(filePath || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
}

function uniqueSorted(values) {
  return [...new Set(values.map(normalizePath).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function gitLines(rootDir, args) {
  try {
    const output = execFileSync("git", args, {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10000,
    });
    return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function resolveDiffBase(rootDir, baseRef) {
  const ref = String(baseRef || "").trim();
  if (!ref) {
    return "";
  }
  const mergeBase = gitLines(rootDir, ["merge-base", "HEAD", ref]);
  return mergeBase[0] || "";
}

function collectChangedFiles(rootDir, baseRef = DEFAULT_BASE_REF) {
  const files = [];
  const diffBase = resolveDiffBase(rootDir, baseRef);
  if (diffBase) {
    files.push(...gitLines(rootDir, ["diff", "--name-only", `${diffBase}...HEAD`]));
  }
  files.push(...gitLines(rootDir, ["diff", "--name-only", "--cached"]));
  files.push(...gitLines(rootDir, ["diff", "--name-only"]));
  files.push(...gitLines(rootDir, ["ls-files", "--others", "--exclude-standard"]));
  return uniqueSorted(files);
}

function isFragmentFileName(filePath) {
  const fileName = path.posix.basename(filePath);
  return fileName.endsWith(".md") && fileName !== "README.md" && !fileName.startsWith("_");
}

function isPatchNoteArtifact(filePath) {
  const normalized = normalizePath(filePath);
  if (!isFragmentFileName(normalized)) {
    return false;
  }
  return normalized.startsWith("docs/patch-notes/unreleased/")
    || normalized.startsWith("docs/patch-notes/releases/");
}

function isReleaseRelevantFile(filePath) {
  const normalized = normalizePath(filePath);
  if (!normalized || isPatchNoteArtifact(normalized)) {
    return false;
  }
  if (RELEASE_RELEVANT_FILES.has(normalized) || RELEASE_RELEVANT_DOC_FILES.has(normalized)) {
    return true;
  }
  if (RELEASE_RELEVANT_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return true;
  }
  return RELEASE_RELEVANT_SCRIPT_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function classifyReleaseHygiene(options) {
  const changedFiles = uniqueSorted(options.changedFiles || []);
  const patchNoteFiles = changedFiles.filter(isPatchNoteArtifact);
  const relevantFiles = changedFiles.filter(isReleaseRelevantFile);
  const requiresPatchNote = relevantFiles.length > 0;
  const hasPatchNoteUpdate = patchNoteFiles.length > 0;
  return {
    ok: !requiresPatchNote || hasPatchNoteUpdate,
    changedFiles,
    hasPatchNoteUpdate,
    patchNoteFiles,
    relevantFiles,
    requiresPatchNote,
  };
}

function checkReleaseHygiene(options = {}) {
  const rootDir = path.resolve(options.rootDir || ROOT);
  const baseRef = options.baseRef || DEFAULT_BASE_REF;
  return classifyReleaseHygiene({
    changedFiles: collectChangedFiles(rootDir, baseRef),
  });
}

function writeList(stream, label, values) {
  stream.write(`${label}\n`);
  for (const value of values) {
    stream.write(`  - ${value}\n`);
  }
}

function writeHelp(stdout) {
  stdout.write([
    "Usage: npm run release:hygiene -- [--base origin/master] [--root /repo]",
    "",
    "Fails when release-relevant branch changes do not include a patch-note artifact.",
    "Normal feature branches should add docs/patch-notes/unreleased/*.md.",
    "Release branches are satisfied by docs/patch-notes/releases/*.md after publish.",
    "",
  ].join("\n"));
}

function run(argv = process.argv.slice(2), stdout = process.stdout, stderr = process.stderr) {
  const options = parseArgs(argv);
  if (options.help) {
    writeHelp(stdout);
    return 0;
  }

  const result = checkReleaseHygiene(options);
  if (result.ok) {
    if (result.relevantFiles.length === 0) {
      stdout.write("release:hygiene: ok - no release-relevant changes detected.\n");
    } else {
      stdout.write(`release:hygiene: ok - patch-note coverage found for ${result.relevantFiles.length} release-relevant file(s).\n`);
    }
    return 0;
  }

  stderr.write("release:hygiene: release-relevant changes need a patch-note artifact.\n");
  writeList(stderr, "Release-relevant files:", result.relevantFiles);
  stderr.write("\nAdd an unreleased fragment, for example:\n");
  stderr.write("  npm run release:note -- --kind gameplay --slug short-slug --summary \"Player-facing summary\"\n");
  stderr.write("\nFor release branches, run `npm run release:publish` so a versioned release note changes with the branch.\n");
  return 1;
}

if (require.main === module) {
  try {
    process.exitCode = run();
  } catch (error) {
    console.error(error && error.message ? error.message : error);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_BASE_REF,
  checkReleaseHygiene,
  classifyReleaseHygiene,
  collectChangedFiles,
  isPatchNoteArtifact,
  isReleaseRelevantFile,
  parseArgs,
  run,
};
