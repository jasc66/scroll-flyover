#!/usr/bin/env node
/**
 * qa.mjs — runs the reproducibility QA against references/index-template.html.
 * -----------------------------------------------------------------------
 * Starts the static server in this process on an ephemeral port, hands the URL to
 * references/qa-reproducibility.mjs, and exits with that check's status. Doing the
 * lifecycle here rather than in a shell one-liner keeps the same command working on
 * Windows and in CI, and guarantees the server is closed even when the check fails.
 *
 * The page under test is the real shipped template, import map and all, so a break
 * in how the engine is loaded counts as a failure rather than being papered over by
 * a test-only harness.
 *
 * Usage: node scripts/qa.mjs [-- <extra args for qa-reproducibility.mjs>]
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticServer, listen } from './serve.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const passThrough = process.argv.includes('--') ? process.argv.slice(process.argv.indexOf('--') + 1) : [];

const server = createStaticServer(REPO_ROOT);
const port = await listen(server, 0);
const url = `http://127.0.0.1:${port}/references/index-template.html`;

console.log(`QA target: ${url}`);

const child = spawn(
  process.execPath,
  [path.join(REPO_ROOT, 'references', 'qa-reproducibility.mjs'), url, ...passThrough],
  { stdio: 'inherit', cwd: REPO_ROOT },
);

const exitCode = await new Promise((resolve) => {
  child.on('exit', (code, signal) => resolve(signal ? 1 : code ?? 1));
  child.on('error', (error) => {
    console.error(`FATAL: could not start the QA check — ${error.message}`);
    resolve(1);
  });
});

server.close();
process.exit(exitCode);
