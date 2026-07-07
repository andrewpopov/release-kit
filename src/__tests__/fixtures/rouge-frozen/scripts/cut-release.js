#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const core = require("./lib/release-notes-core.js");

const ROOT = path.resolve(__dirname, "..");
const VALUE_FLAGS = new Set(["--root", "--version", "--date", "--commit"]);
const VALUE_KEYS = {
  "--root": "rootDir",
  "--version": "version",
  "--date": "date",
  "--commit": "commit",
};

function parseArgs(argv) {
  const parsed = {
    rootDir: ROOT,
    version: "",
    date: "",
    commit: "",
    force: false,
    allowEmpty: false,
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
    } else if (arg === "--force") {
      parsed.force = true;
    } else if (arg === "--allow-empty") {
      parsed.allowEmpty = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function releasePathFor(rootDir, version) {
  return path.join(rootDir, "docs", "patch-notes", "releases", `${version}.md`);
}

function preflightCut(rootDir, targetVersion, options) {
  core.assertAlphaVersion(targetVersion);
  const fragments = core.collectFragments(rootDir);
  if (fragments.length === 0 && !options.allowEmpty) {
    throw new Error("No unreleased patch-note fragments found. Add fragments or pass --allow-empty.");
  }
  const releasePath = releasePathFor(rootDir, targetVersion);
  if (fs.existsSync(releasePath) && !options.force) {
    throw new Error(`${path.relative(rootDir, releasePath)} already exists. Re-run with --force to overwrite it.`);
  }
  return { fragmentCount: fragments.length, releasePath };
}

function cutRelease(options = {}) {
  const rootDir = path.resolve(options.rootDir || ROOT);
  const previousVersion = core.resolveVersion(rootDir);
  const version = String(options.version || core.nextAlphaVersion(previousVersion)).trim();
  const preflight = preflightCut(rootDir, version, options);
  core.bumpAlphaVersion({ rootDir, version });
  const release = core.publishRelease({
    rootDir,
    version,
    date: options.date,
    commit: options.commit,
    force: options.force,
    allowEmpty: options.allowEmpty,
  });
  const validation = core.validateReleaseState(rootDir, version);
  if (!validation.ok) {
    throw new Error(`Release ${version} was cut but failed validation:\n${validation.errors.join("\n")}`);
  }
  return {
    previousVersion,
    version,
    fragmentCount: preflight.fragmentCount,
    releasePath: release.releasePath,
  };
}

function writeHelp(stdout) {
  stdout.write([
    "Usage: npm run release:cut -- [--version 0.2.0-alpha.0] [--date YYYY-MM-DD]",
    "",
    "Bumps package.json/package-lock.json to the next alpha version, publishes",
    "docs/patch-notes/unreleased/*.md into a versioned release note, refreshes",
    "docs/PATCH_NOTES.md, and runs release validation.",
    "",
  ].join("\n"));
}

function run(argv = process.argv.slice(2), stdout = process.stdout) {
  const options = parseArgs(argv);
  if (options.help) {
    writeHelp(stdout);
    return 0;
  }
  const result = cutRelease(options);
  stdout.write(`Cut ${result.previousVersion} -> ${result.version}\n`);
  stdout.write(`Published ${path.relative(path.resolve(options.rootDir || ROOT), result.releasePath)} from ${result.fragmentCount} fragment(s).\n`);
  return 0;
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
  cutRelease,
  parseArgs,
  run,
};
