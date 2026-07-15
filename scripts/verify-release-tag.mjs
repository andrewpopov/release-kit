import fs from 'node:fs';

const intendedTag = process.argv[2] || process.env.RELEASE_TAG;
const version = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const expected = `v${version}`;
if (!intendedTag) { console.error(`release:verify-tag: pass the intended tag (expected ${expected})`); process.exit(1); }
if (intendedTag !== expected) { console.error(`release:verify-tag: manifest ${version} requires ${expected}, received ${intendedTag}`); process.exit(1); }
console.log(`release:verify-tag: ${intendedTag} matches manifest ${version}`);
