/**
 * One chat client for every provider.
 *
 * Almost all providers here speak the OpenAI /chat/completions dialect, so
 * that is the internal wire format. Anthropic is translated in and out. All
 * failures are normalised into an OllyError carrying a `kind` the router uses
 * to decide between retrying, failing over to another model, or giving up.
 */

import { PROVIDERS, getProvider, authHeaders } from './providers.js';

export class OllyError extends Error {
  constructor(message, { kind = 'unknown', status = 0, provider, model, retryable = false, body } = {}) {
    super(message);
    this.name = 'OllyError';
    this.kind = kind;
    this.status = status;
    this.provider = provider;
    this.model = model;
    this.retryable = retryable;
    this.body = body;
  }
}

/**
 * Map an HTTP status onto a failure kind.
 *  auth      - the key is wrong; failing over to the same provider is pointless
 *  rate      - rate limited or out of quota; try a different model
 *  badmodel  - this model id is not served here; drop it from the pool
 *  server    - transient upstream fault; worth a retry
 *  context   - the request was too large for this model
 */
function classify(status, bodyText = '') {
  const b = String(bodyText).toLowerCase();
  if (status === 401 || status === 403) return { kind: 'auth', retryable: false };
  if (status === 429) return { kind: 'rate', retryable: true };
  if (status === 404) return { kind: 'badmodel', retryable: false };
  if (status === 400 || status === 422) {
    if (/context|token|too long|maximum|length/.test(b)) return { kind: 'context', retryable: false };
    if (/model|not found|unsupported|no longer available/.test(b)) return { kind: 'badmodel', retryable: false };
    if (/tool|function/.test(b)) return { kind: 'tools', retryable: false };
    return { kind: 'request', retryable: false };
  }
  if (status === 402) return { kind: 'quota', retryable: false };
  if (status >= 500) return { kind: 'server', retryable: true };
  return { kind: 'unknown', retryable: status === 0 };
}

async function readBody(res) {
  const text = await res.text().catch(() => '');
  try { return { text, json: JSON.parse(text) }; }
  catch { return { text, json: null }; }
}

function errorMessage(json, text) {
  return (
    json?.error?.message ||
    json?.message ||
    json?.detail ||
    (Array.isArray(json) && json[0]?.error?.message) ||
    String(text || '').slice(0, 300) ||
    'request failed'
  );
}

/** fetch with a hard timeout that also respects an external abort signal. */
async function fetchWithTimeout(url, opts, timeoutMs, external) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('timeout')), timeoutMs);
  const onAbort = () => ctrl.abort(external.reason);
  if (external) external.addEventListener('abort', onAbort, { once: true });
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
    if (external) external.removeEventListener('abort', onAbort);
  }
}

// ---------------------------------------------------------------------------
// Anthropic translation
// ---------------------------------------------------------------------------

function toAnthropic({ messages, tools, temperature, max_tokens }) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const out = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      out.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: String(m.content ?? '') }],
      });
      continue;
    }
    if (m.role === 'assistant' && m.tool_calls?.length) {
      const content = [];
      if (m.content) content.push({ type: 'text', text: m.content });
      for (const tc of m.tool_calls) {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: safeJson(tc.function.arguments) ?? {},
        });
      }
      out.push({ role: 'assistant', content });
      continue;
    }
    out.push({ role: m.role, content: String(m.content ?? '') });
  }
  const body = { messages: out, max_tokens: max_tokens || 8192, temperature };
  if (system) body.system = system;
  if (tools?.length) {
    body.tools = tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
  }
  return body;
}

function fromAnthropic(json) {
  const blocks = json.content || [];
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const toolUses = blocks.filter((b) => b.type === 'tool_use');
  const message = { role: 'assistant', content: text || null };
  if (toolUses.length) {
    message.tool_calls = toolUses.map((b) => ({
      id: b.id,
      type: 'function',
      function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
    }));
  }
  return {
    message,
    finish_reason: json.stop_reason === 'tool_use' ? 'tool_calls' : 'stop',
    usage: {
      prompt_tokens: json.usage?.input_tokens ?? 0,
      completion_tokens: json.usage?.output_tokens ?? 0,
    },
  };
}

export function safeJson(s) {
  if (s == null) return null;
  if (typeof s === 'object') return s;
  try { return JSON.parse(s); } catch { /* fall through */ }
  // Models occasionally emit trailing commas or wrap JSON in prose.
  const m = String(s).match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* give up */ } }
  return null;
}

// ---------------------------------------------------------------------------
// Streaming accumulation
// ---------------------------------------------------------------------------

/** Merge one OpenAI streaming delta into the message being built. */
function applyDelta(acc, delta) {
  if (!delta) return;
  if (delta.role) acc.role = delta.role;
  if (typeof delta.content === 'string') acc.content = (acc.content || '') + delta.content;
  if (delta.reasoning_content) acc.reasoning = (acc.reasoning || '') + delta.reasoning_content;
  for (const tc of delta.tool_calls || []) {
    const i = tc.index ?? 0;
    acc.tool_calls[i] ||= { id: '', type: 'function', function: { name: '', arguments: '' } };
    const slot = acc.tool_calls[i];
    if (tc.id) slot.id = tc.id;
    if (tc.type) slot.type = tc.type;
    if (tc.function?.name) slot.function.name += tc.function.name;
    if (tc.function?.arguments) slot.function.arguments += tc.function.arguments;
    // Gemini 3 returns a thought signature that must be echoed back verbatim
    // on the next turn, so carry any provider extras through untouched.
    if (tc.extra_content) slot.extra_content = { ...(slot.extra_content || {}), ...tc.extra_content };
  }
}

async function* sseLines(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) yield line;
    }
  }
  if (buf.trim()) yield buf.trim();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run one chat completion.
 *
 * @param {object} o
 * @param {string} o.provider   provider id
 * @param {string} o.key        credential (may be '' for local providers)
 * @param {string} o.model      model id as the provider names it
 * @param {Array}  o.messages   OpenAI-format message list
 * @param {Array}  [o.tools]    OpenAI-format tool definitions
 * @param {boolean}[o.stream]   stream text deltas to `onDelta`
 * @param {(t:string)=>void} [o.onDelta]
 * @returns {Promise<{message:object, finish_reason:string, usage:object, ms:number}>}
 */
export async function chat({
  provider, key, model, messages, tools, stream = false, onDelta,
  temperature = 0.2, maxTokens = 8192, timeoutMs = 180000, signal,
}) {
  const p = getProvider(provider);
  if (!p) throw new OllyError(`unknown provider "${provider}"`, { kind: 'config' });

  const started = Date.now();
  const isAnthropic = p.api === 'anthropic';
  const url = isAnthropic ? `${p.base}/messages` : `${p.base}/chat/completions`;

  let body;
  if (isAnthropic) {
    body = { model, ...toAnthropic({ messages, tools, temperature, max_tokens: maxTokens }) };
  } else {
    body = { model, messages, temperature, max_tokens: maxTokens };
    if (tools?.length) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }
    if (stream) {
      body.stream = true;
      body.stream_options = { include_usage: true };
    }
  }

  let res;
  try {
    res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: authHeaders(p, key),
      body: JSON.stringify(body),
    }, timeoutMs, signal);
  } catch (e) {
    const aborted = e?.name === 'AbortError';
    throw new OllyError(aborted ? 'request timed out' : `network error: ${e.message}`, {
      kind: aborted ? 'timeout' : 'network', provider, model, retryable: true,
    });
  }

  if (!res.ok) {
    const { text, json } = await readBody(res);
    const { kind, retryable } = classify(res.status, text);
    throw new OllyError(errorMessage(json, text), {
      kind, status: res.status, provider, model, retryable, body: json ?? text,
    });
  }

  // --- non-streaming ---
  if (!stream || isAnthropic || !res.body) {
    const { text, json } = await readBody(res);
    if (!json) {
      throw new OllyError('provider returned a non-JSON response', {
        kind: 'server', provider, model, retryable: true, body: text.slice(0, 400),
      });
    }
    if (isAnthropic) return { ...fromAnthropic(json), ms: Date.now() - started };
    const choice = json.choices?.[0];
    if (!choice) {
      throw new OllyError('provider returned no choices', { kind: 'server', provider, model, retryable: true, body: json });
    }
    if (onDelta && choice.message?.content) onDelta(choice.message.content);
    return {
      message: choice.message || { role: 'assistant', content: '' },
      finish_reason: choice.finish_reason || 'stop',
      usage: json.usage || {},
      ms: Date.now() - started,
    };
  }

  // --- streaming ---
  const acc = { role: 'assistant', content: '', tool_calls: [] };
  let finish = 'stop';
  let usage = {};

  for await (const line of sseLines(res)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (payload === '[DONE]') break;
    const evt = safeJson(payload);
    if (!evt) continue;
    if (evt.error) {
      throw new OllyError(errorMessage(evt, payload), { kind: 'server', provider, model, retryable: true, body: evt });
    }
    if (evt.usage) usage = evt.usage;
    const choice = evt.choices?.[0];
    if (!choice) continue;
    if (choice.finish_reason) finish = choice.finish_reason;
    const before = acc.content.length;
    applyDelta(acc, choice.delta);
    if (onDelta && acc.content.length > before) onDelta(acc.content.slice(before));
  }

  const message = { role: 'assistant', content: acc.content || null };
  const calls = acc.tool_calls.filter(Boolean);
  if (calls.length) {
    message.tool_calls = calls;
    if (finish !== 'tool_calls') finish = 'tool_calls';
  }
  return { message, finish_reason: finish, usage, ms: Date.now() - started };
}

/** Ask a provider which models it will serve for this key. */
export async function listModels(provider, key, timeoutMs = 20000) {
  const p = getProvider(provider);
  if (!p || p.kind) return [];
  const url = p.modelsUrl || `${p.base}/models`;
  const res = await fetchWithTimeout(url, { headers: authHeaders(p, key) }, timeoutMs, null)
    .catch(() => null);
  if (!res || !res.ok) return [];
  const { json } = await readBody(res);
  if (!json) return [];
  // OpenAI shape: {data:[{id}]}. Google native shape: {models:[{name}]}.
  const raw = json.data || json.models || [];
  return raw
    .map((m) => String(m.id || m.name || '').replace(/^models\//, ''))
    .filter(Boolean);
}

/**
 * Check a credential by making the cheapest authenticated call available.
 * Returns true/false, or null when the check itself could not be performed.
 */
export async function verifyKey(provider, key, timeoutMs = 20000) {
  const p = getProvider(provider);
  if (!p) return false;

  if (p.kind === 'scm') {
    const res = await fetchWithTimeout(`${p.base}/user`, {
      headers: { Authorization: `Bearer ${key}`, 'User-Agent': 'OllyAI', Accept: 'application/vnd.github+json' },
    }, timeoutMs, null).catch(() => null);
    return res ? res.ok : null;
  }
  if (p.kind) return null; // nothing cheap to call for 'other' providers

  const url = p.modelsUrl || `${p.base}/models`;
  const res = await fetchWithTimeout(url, { headers: authHeaders(p, key) }, timeoutMs, null).catch(() => null);
  if (!res) return null;
  if (res.status === 401 || res.status === 403) return false;
  return res.ok || res.status === 429;
}

export { PROVIDERS };
