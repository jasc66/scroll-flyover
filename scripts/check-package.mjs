#!/usr/bin/env node
/**
 * check-package.mjs — asserts the published tarball still carries its entry points.
 * -----------------------------------------------------------------------
 * `files` in package.json is an allowlist, so removing an entry does not fail any
 * build: it publishes a package whose documented import path simply 404s for
 * everyone who installs it. Nothing else in this repo notices, because the source
 * files are all still sitting right there in the working tree.
 */
import { execFileSync } from 'node:child_process';

const REQUIRED = [
  'package.json',
  'SKILL.md',
  'CHANGELOG.md',
  'bin/install.js',
  'references/scrub-engine.js',
  'references/index-template.html',
  'references/qa-reproducibility.mjs',
];

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const raw = execFileSync(npm, ['pack', '--dry-run', '--json'], { encoding: 'utf8', shell: process.platform === 'win32' });

// npm prints the pack summary to stderr and the JSON to stdout, but older npm
// versions have been known to prepend notices — so parse from the first bracket.
const parsed = JSON.parse(raw.slice(raw.indexOf('[')));
const files = parsed[0].files.map((file) => file.path.replace(/\\/g, '/'));

const missing = REQUIRED.filter((required) => !files.includes(required));
if (missing.length) {
  console.error(`FAIL: these paths are documented but missing from the tarball:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}

// The credentials incident that put an .npmrc in a public repo makes this worth
// asserting rather than assuming: nothing secret should ever ride along in a publish.
const leaked = files.filter((file) => /(^|\/)\.(npmrc|env)$/.test(file));
if (leaked.length) {
  console.error(`FAIL: the tarball would publish ${leaked.join(', ')} — remove it before releasing.`);
  process.exit(1);
}

console.log(`PASS: tarball carries all ${REQUIRED.length} required paths (${files.length} files, ${parsed[0].size} bytes packed).`);
