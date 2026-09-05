/** POST /api/repos - the repositories the caller's GitHub token can reach. */
import { listRepos, whoami, listOrgs } from '../src/tools/github.js';
import { json, readJsonBody, keysFromRequest } from './_lib.js';

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
  let body;
  try { body = await readJsonBody(req); } catch (e) { return json(res, 400, { error: e.message }); }

  const token = keysFromRequest(body).github;
  if (!token) return json(res, 200, { ok: false, error: 'Add a GitHub token to list your repositories.' });

  try {
    const user = await whoami(token);
    const [repos, orgs] = await Promise.all([listRepos(token), listOrgs(token)]);

    // Explain up front why a repository the user expects might be missing,
    // rather than leaving them to guess at token settings.
    let hint = null;
    if (user.fineGrained) {
      hint = 'This is a fine-grained token: it only reaches repositories explicitly '
        + 'selected under Repository access, and an organisation must approve it.';
    } else if (user.scopes && !user.scopes.includes('repo')) {
      hint = `This classic token has scopes [${user.scopes.join(', ') || 'none'}]. `
        + 'Private and organisation repositories need the full "repo" scope.';
    }

    return json(res, 200, { ok: true, user, repos, orgs, hint });
  } catch (e) {
    return json(res, 200, {
      ok: false,
      error: /401/.test(e.message)
        ? 'That GitHub token was rejected. It may be expired or revoked.'
        : e.message,
    });
  }
}
