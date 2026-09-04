/**
 * GET /api/status - what this deployment can do before the visitor types
 * anything: whether the host supplied a key, and which providers it covers.
 */
import { OmniRouter } from '../src/router/router.js';
import { PROVIDERS } from '../src/router/providers.js';
import { json, hostKeys } from './_lib.js';

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  const keys = hostKeys();
  const providers = Object.keys(keys);
  let models = 0;
  let brain = null;

  if (providers.length) {
    const router = new OmniRouter({ keys });
    models = router.pool().length;
    const pick = router.pick({ task: 'code' });
    if (pick) brain = { model: pick.model.id, name: pick.model.name, provider: pick.provider };
  }

  return json(res, 200, {
    hostKey: providers.length > 0,
    providers: providers.map((id) => ({ id, label: PROVIDERS[id]?.label || id })),
    models,
    brain,
  });
}
