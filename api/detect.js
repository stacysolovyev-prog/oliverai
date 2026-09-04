/** POST /api/detect - identify which providers a pasted blob contains keys for. */
import { parseKeys, redact } from '../src/router/keyparse.js';
import { verifyKey } from '../src/router/chat.js';
import { PROVIDERS } from '../src/router/providers.js';
import { json, readJsonBody } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
  let body;
  try { body = await readJsonBody(req); } catch (e) { return json(res, 400, { error: e.message }); }

  const found = parseKeys(String(body.text || ''));
  if (!found.length) return json(res, 200, { keys: [] });

  const seen = new Set();
  const keys = [];
  for (const f of found) {
    if (!f.provider || seen.has(f.provider)) continue;
    seen.add(f.provider);
    const p = PROVIDERS[f.provider];
    let verified = null;
    if (body.verify !== false) {
      verified = await verifyKey(f.provider, f.key).catch(() => null);
    }
    keys.push({
      provider: f.provider,
      label: p?.label || f.label,
      kind: p?.kind || 'inference',
      free: Boolean(p?.free),
      confidence: f.confidence,
      reason: f.reasons[0],
      masked: redact(f.key),
      // Echoed back so the browser can keep it in localStorage; the server
      // stores nothing.
      key: f.key,
      verified,
    });
  }
  return json(res, 200, { keys });
}
