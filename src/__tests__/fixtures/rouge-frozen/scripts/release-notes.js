#!/usr/bin/env node
"use strict";

const path = require("node:path");
const core = require("./lib/release-notes-core.js");

const ROOT = path.resolve(__dirname, "..");
const VALUE_FLAGS = new Set(["--root", "--version", "--date", "--kind", "--slug", "--summary", "--commit"]);
const COMMAND_FLAGS = new Map([
  ["--preview", "preview"],
  ["--publish", "publish"],
  ["--check", "check"],
  ["--bump", "bump"],
]);
const VALUE_KEYS = {
  "--root": "rootDir",
  "--version": "version",
  "--date": "date",
  "--kind": "kind",
  "--slug": "slug",
  "--summary": "summary",
  "--commit": "commit",
};

function parseArgs(argv) {
  const parsed = {
    command: "preview",
    rootDir: ROOT,
    version: "",
    date: "",
    kind: "highlight",
    slug: "",
    summary: "",
    commit: "",
    force: false,
    allowEmpty: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (COMMAND_FLAGS.has(arg)) {
      parsed.command = COMMAND_FLAGS.get(arg);
    } else if (arg === "--new") {
      parsed.command = "new";
      if (next && !next.startsWith("-")) {
        parsed.slug = next;
        index += 1;
      }
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

function run(argv = process.argv.slice(2), stdout = process.stdout, stderr = process.stderr) {
  const options = parseArgs(argv);
  const rootDir = path.resolve(options.rootDir || ROOT);
  const version = core.resolveVersion(rootDir, options.version);

  if (options.command === "check") {
    const result = core.validateReleaseState(rootDir, version);
    if (!result.ok) {
      for (const error of result.errors) {
        stderr.write(`release:check: ${error}\n`);
      }
      return 1;
    }
    stdout.write(`release:check: ${version} is ready.\n`);
    return 0;
  }

  if (options.command === "new") {
    const filePath = core.writeNewFragment(options);
    stdout.write(`Created ${path.relative(rootDir, filePath)}\n`);
    return 0;
  }

  if (options.command === "bump") {
    const result = core.bumpAlphaVersion(options);
    stdout.write(`Bumped game version ${result.previousVersion} -> ${result.version}\n`);
    return 0;
  }

  if (options.command === "publish") {
    const result = core.publishRelease(options);
    stdout.write(`Published ${path.relative(rootDir, result.releasePath)} from ${result.fragmentCount} fragment(s).\n`);
    return 0;
  }

  core.assertAlphaVersion(version);
  stdout.write(core.renderReleaseNote({
    version,
    date: options.date || core.todayIso(),
    fragments: core.collectFragments(rootDir),
    commit: core.getGitShortSha(rootDir),
  }));
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
  ...core,
  parseArgs,
  run,
};
