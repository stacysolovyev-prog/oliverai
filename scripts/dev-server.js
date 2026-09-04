#!/usr/bin/env node
/**
 * Local dev server for the web UI.
 *
 * Serves `public/` and routes /api/* to the same handlers Vercel runs, so
 * `npm run web` behaves like the deployment.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3000);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + req.headers.host);

  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice(5).replace(/[^a-z0-9_-]/gi, '');
    const file = path.join(root, 'api', name + '.js');
    if (!fs.existsSync(file)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'no such endpoint /api/' + name }));
    }
    try {
      const mod = await import('file://' + file);
      return await mod.default(req, res);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: e.message }));
    }
  }

  const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = path.join(root, 'public', rel);
  if (!file.startsWith(path.join(root, 'public')) || !fs.existsSync(file)) {
    res.writeHead(404);
    return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, () => console.log('OllyAI web on http://localhost:' + PORT));
