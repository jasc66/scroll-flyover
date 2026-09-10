#!/usr/bin/env node
/**
 * serve.mjs — a dependency-free static server for the reference files.
 * -----------------------------------------------------------------------
 * `file://` cannot load the engine: index-template.html imports it as an ES
 * module, and module requests from a file:// page are blocked by CORS. So
 * anything that opens the template — a browser, or the Playwright QA — needs it
 * served over http.
 *
 * The obvious off-the-shelf alternatives each break this specific page:
 *   - `python -m http.server` can serve .js as text/plain on Windows, because it
 *     resolves MIME types through the registry. A module served as text/plain is
 *     refused by the browser's strict MIME checking, and the page renders nothing.
 *   - `npx serve` / `npx http-server` redirect `/x/index.html` to `/x`, which
 *     silently changes the base URL and so breaks the template's relative
 *     `./scrub-engine.js` import.
 *
 * Usage:
 *   node scripts/serve.mjs [--root .] [--port 4173]
 */
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Explicit, not looked up from the OS — see the Windows note above.
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export function createStaticServer(root = REPO_ROOT) {
  const rootDir = path.resolve(root);

  return http.createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(body);
    };

    try {
      const requestPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      // Resolve first, then confirm the result is still inside the root: this is what
      // stops `../../` and absolute paths from reaching outside the served directory.
      const resolved = path.resolve(rootDir, `.${path.sep}${requestPath}`);
      if (resolved !== rootDir && !resolved.startsWith(rootDir + path.sep)) {
        return send(403, 'Forbidden');
      }

      let filePath = resolved;
      const info = await stat(filePath).catch(() => null);
      if (info?.isDirectory()) {
        // Served, never redirected — a redirect to the extensionless form would change
        // the base URL that the page's relative imports resolve against.
        filePath = path.join(filePath, 'index.html');
      }
      const fileInfo = await stat(filePath).catch(() => null);
      if (!fileInfo?.isFile()) return send(404, `Not found: ${requestPath}`);

      res.writeHead(200, {
        'content-type': MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
        'content-length': fileInfo.size,
        'cache-control': 'no-store',
      });
      createReadStream(filePath).pipe(res);
    } catch (error) {
      send(500, `Server error: ${error.message}`);
    }
  });
}

export function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server.address().port));
  });
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const flag = (name, fallback) => {
    const i = process.argv.indexOf(name);
    return i !== -1 ? process.argv[i + 1] : fallback;
  };
  const root = path.resolve(flag('--root', REPO_ROOT));
  const port = await listen(createStaticServer(root), Number(flag('--port', 4173)));
  console.log(`Serving ${root} at http://127.0.0.1:${port}`);
  console.log(`Template: http://127.0.0.1:${port}/references/index-template.html`);
}
