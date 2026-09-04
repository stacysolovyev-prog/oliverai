import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Root of all OllyAI user state. Override with OLLYAI_HOME.
 *
 * On serverless platforms the home directory is read-only and only /tmp can
 * be written, so detect that and fall back rather than failing on first use.
 */
const SERVERLESS = Boolean(
  process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT,
);

export function ollyHome() {
  if (process.env.OLLYAI_HOME) return process.env.OLLYAI_HOME;
  if (SERVERLESS) return '/tmp/.ollyai';
  return path.join(os.homedir(), '.ollyai');
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
  // A read-only filesystem must not take down a request that never needed to
  // persist anything, so treat directory creation as best effort.
  try {
    if (!fs.existsSync(h)) fs.mkdirSync(h, { recursive: true, mode: 0o700 });
    for (const d of [paths.sessions, paths.workspaces, paths.logs]) {
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
    }
  } catch { /* stateless environment; callers fall back to defaults */ }
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
  // Callers that must know about a failure catch it; the rest treat state as
  // best effort so a read-only disk never breaks a request.

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
