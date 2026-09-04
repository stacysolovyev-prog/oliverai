import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

/** Root of all OllyAI user state. Override with OLLYAI_HOME. */
export function ollyHome() {
  return process.env.OLLYAI_HOME || path.join(os.homedir(), '.ollyai');
}

export const paths = {
  get home() { return ollyHome(); },
  get config() { return path.join(ollyHome(), 'config.json'); },
  get keys() { return path.join(ollyHome(), 'keys.json'); },
  get sessions() { return path.join(ollyHome(), 'sessions'); },
  get workspaces() { return path.join(ollyHome(), 'workspaces'); },
  get logs() { return path.join(ollyHome(), 'logs'); },
  get health() { return path.join(ollyHome(), 'health.json'); },
};

export function ensureHome() {
  const h = ollyHome();
  if (!fs.existsSync(h)) fs.mkdirSync(h, { recursive: true, mode: 0o700 });
  for (const d of [paths.sessions, paths.workspaces, paths.logs]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  }
  return h;
}

/** Read JSON, returning `fallback` on any error. */
export function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

/** Write JSON atomically with owner-only permissions (these files hold secrets). */
export function writeJson(file, data, mode = 0o600) {
  ensureHome();
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, mode); } catch { /* best effort on odd filesystems */ }
}

/** Display a path relative to cwd when it lives under it. */
export function relPath(p, base = process.cwd()) {
  const r = path.relative(base, p);
  return !r.startsWith('..') && !path.isAbsolute(r) ? (r || '.') : p;
}
