/** POST /api/route - the ranking table for a task, given the caller's keys. */
import { OmniRouter } from '../src/router/router.js';
import { json, readJsonBody, keysFromRequest } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
  let body;
  try { body = await readJsonBody(req); } catch (e) { return json(res, 400, { error: e.message }); }

  const router = new OmniRouter({ keys: keysFromRequest(body) });
  await router.refresh().catch(() => {});
  return json(res, 200, {
    providers: router.availableProviders(),
    poolSize: router.pool().length,
    ranking: router.explain(body.task || 'code', 12),
  });
}
