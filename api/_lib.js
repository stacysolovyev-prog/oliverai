/** Shared helpers for the serverless endpoints. */

// The key store writes to OLLYAI_HOME; on Vercel only /tmp is writable.
process.env.OLLYAI_HOME ||= '/tmp/.ollyai';

export function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new Error('request body must be JSON'); }
}

/**
 * Keys arrive with each request and are used only to serve it. Nothing is
 * written to disk and nothing is logged, so the deployment never holds a
 * visitor's credentials.
 */
export function keysFromRequest(body) {
  const out = {};
  for (const [k, v] of Object.entries(body.keys || {})) {
    if (typeof v === 'string' && v.trim()) out[k] = v.trim();
  }
  return out;
}
