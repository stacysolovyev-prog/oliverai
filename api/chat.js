/**
 * POST /api/chat - run one routed completion.
 *
 * The browser sends its own keys with every request. They are used to serve
 * that request and then discarded; nothing is persisted server-side.
 */
import { OmniRouter, classifyTask } from '../src/router/router.js';
import { json, readJsonBody, keysFromRequest } from './_lib.js';

const SYSTEM = `You are OllyAI, a coding assistant. Answer concisely and
practically. Use fenced code blocks with a language tag for any code. When you
are unsure, say so rather than guessing at file contents you have not seen.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });

  let body;
  try { body = await readJsonBody(req); } catch (e) { return json(res, 400, { error: e.message }); }

  const keys = keysFromRequest(body);
  if (!Object.keys(keys).length) {
    return json(res, 400, { error: 'No API key supplied. Paste one in the sidebar - any format works.' });
  }

  const history = Array.isArray(body.messages) ? body.messages.slice(-24) : [];
  const last = [...history].reverse().find((m) => m.role === 'user');
  const task = body.task || classifyTask(last?.content || '');

  const router = new OmniRouter({ keys, model: body.model || 'auto' });
  const failovers = [];

  try {
    const out = await router.complete({
      task,
      messages: [{ role: 'system', content: SYSTEM }, ...history],
      onFailover: (f) => failovers.push(f),
      maxTokens: 4096,
    });
    return json(res, 200, {
      reply: out.message.content || '',
      task,
      model: out.pick.model.id,
      modelName: out.pick.model.name,
      provider: out.pick.provider,
      free: out.pick.model.free,
      ms: out.ms,
      attempts: out.attempts,
      failovers,
      usage: out.usage,
    });
  } catch (e) {
    return json(res, 502, { error: e.message, kind: e.kind || 'unknown', failovers });
  }
}
