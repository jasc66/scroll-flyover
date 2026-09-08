#!/usr/bin/env node
/**
 * run-qa.mjs
 * -----------------------------------------------------------------------
 * CI entrypoint: starts scripts/serve.mjs, runs qa-reproducibility.mjs and
 * qa-accessibility.mjs against every runnable example under examples/
 * (any directory containing an index.html — this excludes _shared, which
 * is a JS module, and portfolio-alonso, which is screenshots of an
 * external production site, not a servable local build), then reports a
 * combined pass/fail. Used by .github/workflows/qa.yml; also runnable
 * locally via `npm run qa`.
 */
import { spawn, spawnSync } from 'node:child_process';
import { readdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = 8080;
const baseUrl = `http://localhost:${port}`;

async function findExamples() {
  const entries = await readdir(path.join(root, 'examples'), { withFileTypes: true });
  const names = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      await access(path.join(root, 'examples', entry.name, 'index.html'));
      names.push(entry.name);
    } catch {
      // no index.html — not a servable example (e.g. _shared, portfolio-alonso)
    }
  }
  return names.sort();
}

function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function poll() {
      fetch(url)
        .then(() => resolve())
        .catch(() => {
          if (Date.now() - start > timeoutMs) reject(new Error(`server never came up at ${url}`));
          else setTimeout(poll, 300);
        });
    })();
  });
}

function runScript(scriptName, url) {
  const result = spawnSync(process.execPath, [path.join(root, scriptName), url], {
    stdio: 'inherit',
  });
  return result.status === 0;
}

async function main() {
  const examples = await findExamples();
  console.log(`Found ${examples.length} runnable example(s): ${examples.join(', ')}`);

  const server = spawn(process.execPath, [path.join(root, 'scripts', 'serve.mjs'), String(port)], {
    stdio: 'inherit',
  });

  let failed = false;
  try {
    await waitForServer(baseUrl);

    for (const name of examples) {
      const url = `${baseUrl}/examples/${name}/index.html`;
      console.log(`\n=== ${name} ===`);

      console.log(`-- reproducibility (${url}) --`);
      if (!runScript(path.join('references', 'qa-reproducibility.mjs'), url)) failed = true;

      console.log(`-- accessibility / color-contrast (${url}) --`);
      if (!runScript(path.join('scripts', 'qa-accessibility.mjs'), url)) failed = true;
    }
  } finally {
    server.kill();
  }

  if (failed) {
    console.error('\nQA FAILED — see failures above.');
    process.exit(1);
  }
  console.log('\nQA PASSED for all examples.');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
