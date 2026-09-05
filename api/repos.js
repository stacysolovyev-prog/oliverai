/** POST /api/repos - the repositories the caller's GitHub token can reach. */
import { listRepos, whoami } from '../src/tools/github.js';
import { json, readJsonBody, keysFromRequest } from './_lib.js';

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
  let body;
  try { body = await readJsonBody(req); } catch (e) { return json(res, 400, { error: e.message }); }

  const token = keysFromRequest(body).github;
  if (!token) return json(res, 200, { ok: false, error: 'Add a GitHub token to list your repositories.' });

  try {
    const [user, repos] = await Promise.all([whoami(token), listRepos(token)]);
    return json(res, 200, { ok: true, user, repos });
  } catch (e) {
    return json(res, 200, {
      ok: false,
      error: /401/.test(e.message)
        ? 'That GitHub token was rejected. It may be expired or revoked.'
        : e.message,
    });
  }
}
