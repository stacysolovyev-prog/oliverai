/** POST /api/repo - check whether a token can reach a repository. */
import { canAccess, whoami } from '../src/tools/github.js';
import { json, readJsonBody, keysFromRequest } from './_lib.js';

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
  let body;
  try { body = await readJsonBody(req); } catch (e) { return json(res, 400, { error: e.message }); }

  const token = keysFromRequest(body).github;
  if (!token) return json(res, 200, { ok: false, error: 'No GitHub token. Paste one in the key panel.' });

  let user = null;
  try { user = await whoami(token); } catch (e) { return json(res, 200, { ok: false, error: e.message }); }
  if (!body.repo) return json(res, 200, { ok: false, user, error: 'No repository given.' });

  const access = await canAccess(token, body.repo);
  return json(res, 200, { ...access, user });
}
