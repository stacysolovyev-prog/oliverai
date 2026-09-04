/**
 * OmniRoute - the model router.
 *
 * The idea is the one OpenRouter popularised: you should never have to care
 * which model answers. You give OllyAI whatever keys you have, and for each
 * turn it picks the best model you can actually reach, then fails over the
 * moment one rate-limits or errors.
 *
 * Selection has four inputs:
 *   1. which providers you hold a working key for
 *   2. what kind of task this turn is (plan / code / fast / long)
 *   3. a curated quality+speed score per model, weighted by that task
 *   4. live health - recent failures put a model in cooldown
 */

import { CATALOG, findModel, inferModelMeta } from './catalog.js';
import { PROVIDERS, getProvider } from './providers.js';
import { chat, listModels, OllyError } from './chat.js';
import { getKey, loadConfig, configuredProviders } from '../core/config.js';
import { paths, readJson, writeJson } from '../util/paths.js';

/** How much each task class cares about quality vs. raw speed. */
const WEIGHTS = {
  plan: { quality: 1.0, speed: 0.15, tag: 2.5 },
  code: { quality: 0.8, speed: 0.45, tag: 2.5 },
  fast: { quality: 0.3, speed: 1.0, tag: 2.5 },
  long: { quality: 0.75, speed: 0.3, tag: 2.0 },
  vision: { quality: 0.8, speed: 0.4, tag: 4.0 },
};

const FREE_BONUS = 2.0;          // applied when preferFree is on
const TOOLS_PENALTY = 12.0;      // effectively disqualifying when tools are required
const BASE_COOLDOWN_MS = 60_000; // doubles per consecutive failure, capped below
const MAX_COOLDOWN_MS = 15 * 60_000;

// ---------------------------------------------------------------------------
// Health tracking
// ---------------------------------------------------------------------------

let _health = null;

function health() {
  if (!_health) _health = readJson(paths.health, {}) || {};
  return _health;
}

function healthKey(provider, model) { return `${provider}:${model}`; }

function saveHealth() {
  try { writeJson(paths.health, _health || {}, 0o600); } catch { /* non-fatal */ }
}

export function recordSuccess(provider, model, ms) {
  const h = health();
  const k = healthKey(provider, model);
  const e = h[k] || { ok: 0, fail: 0, streak: 0, avgMs: ms };
  e.ok += 1;
  e.streak = 0;
  e.cooldownUntil = 0;
  // Exponential moving average keeps the router responsive to slowdowns.
  e.avgMs = e.avgMs ? Math.round(e.avgMs * 0.7 + ms * 0.3) : ms;
  e.lastOk = Date.now();
  h[k] = e;
  saveHealth();
}

export function recordFailure(provider, model, kind) {
  const h = health();
  const k = healthKey(provider, model);
  const e = h[k] || { ok: 0, fail: 0, streak: 0, avgMs: 0 };
  e.fail += 1;
  e.streak += 1;
  e.lastKind = kind;
  e.lastFail = Date.now();
  // A wrong model id or a dead key should not be retried this session at all.
  if (kind === 'badmodel' || kind === 'auth' || kind === 'quota') {
    e.cooldownUntil = Date.now() + MAX_COOLDOWN_MS;
    e.disabled = kind;
  } else {
    e.cooldownUntil = Date.now() + Math.min(MAX_COOLDOWN_MS, BASE_COOLDOWN_MS * 2 ** (e.streak - 1));
  }
  h[k] = e;
  saveHealth();
}

export function healthOf(provider, model) {
  return health()[healthKey(provider, model)] || null;
}

export function resetHealth() {
  _health = {};
  saveHealth();
}

// ---------------------------------------------------------------------------
// Task classification
// ---------------------------------------------------------------------------

/**
 * Decide what kind of turn this is from the prompt and conversation size.
 * Cheap and deterministic - the router runs this on every turn, so it must
 * never cost a model call. `classifyWithModel` is the optional LLM upgrade.
 */
export function classifyTask(prompt, { contextTokens = 0, needsVision = false } = {}) {
  const s = String(prompt || '').toLowerCase();

  if (needsVision) return 'vision';
  if (contextTokens > 100_000) return 'long';

  const planning = /\b(architect|design|plan|refactor|strategy|why|debug|investigate|root cause|trade-?off|approach|explain how|compare|review|audit|security)\b/;
  const quick = /\b(what is|list|show|find|where is|rename|typo|format|lint|bump|version|status|summar)\b/;
  const coding = /\b(implement|add|write|create|fix|update|change|edit|build|test|migrate|port|delete|remove|wire|hook up)\b/;

  if (planning.test(s)) return 'plan';
  if (coding.test(s)) return 'code';
  if (quick.test(s) && s.length < 160) return 'fast';
  // Long, detailed asks tend to be real work; short ones tend to be lookups.
  return s.length > 220 ? 'code' : 'fast';
}

/**
 * Optional: let a cheap model classify the turn. Used when
 * `config.smartRouting` is on. Falls back to the heuristic on any failure.
 */
export async function classifyWithModel(prompt, router) {
  try {
    const pick = router.pick({ task: 'fast', needsTools: false });
    if (!pick) return classifyTask(prompt);
    const res = await chat({
      provider: pick.provider,
      key: pick.key,
      model: pick.model.id,
      temperature: 0,
      maxTokens: 500,
      timeoutMs: 15000,
      messages: [
        {
          role: 'system',
          content:
            'Classify the user\'s software-engineering request into exactly one label: ' +
            'plan (architecture, debugging, review, hard reasoning), ' +
            'code (writing or editing source files), ' +
            'fast (a quick lookup or trivial edit), ' +
            'long (needs to read a very large amount of context). ' +
            'Reply with the single label and nothing else.',
        },
        { role: 'user', content: String(prompt).slice(0, 2000) },
      ],
    });
    const label = String(res.message.content || '').trim().toLowerCase().match(/plan|code|fast|long/);
    return label ? label[0] : classifyTask(prompt);
  } catch {
    return classifyTask(prompt);
  }
}

// ---------------------------------------------------------------------------
// The router
// ---------------------------------------------------------------------------

export class OmniRouter {
  constructor(options = {}) {
    this.config = { ...loadConfig(), ...options };
    /** Models discovered live from provider /models endpoints. */
    this.discovered = new Map();
    /** Set by `/model <id>` to force one model for everything. */
    this.pinned = this.config.model && this.config.model !== 'auto' ? this.config.model : null;
    this.lastPick = null;
    this.stats = { calls: 0, failovers: 0, byModel: {} };
  }

  /** Providers we hold a usable inference credential for. */
  availableProviders() {
    return configuredProviders().filter((id) => {
      const p = getProvider(id);
      return p && !p.kind;
    });
  }

  /**
   * Ask every configured provider what it actually serves, and merge anything
   * new into the pool. Makes the catalog self-healing when providers rename
   * or retire models.
   */
  async refresh({ onProgress } = {}) {
    const results = [];
    for (const id of this.availableProviders()) {
      const cred = getKey(id);
      if (!cred) continue;
      onProgress?.(id);
      const ids = await listModels(id, cred.key).catch(() => []);
      this.discovered.set(id, ids);
      results.push({ provider: id, count: ids.length });
    }
    return results;
  }

  /** The full candidate pool: curated catalog plus anything discovered. */
  pool() {
    const providers = new Set(this.availableProviders());
    const out = [];
    const seen = new Set();

    for (const m of CATALOG) {
      if (!providers.has(m.provider)) continue;
      const disc = this.discovered.get(m.provider);
      // If we asked the provider and it did not list this model, skip it.
      if (disc && disc.length && !disc.includes(m.id)) continue;
      out.push(m);
      seen.add(`${m.provider}:${m.id}`);
    }

    for (const [provider, ids] of this.discovered) {
      if (!providers.has(provider)) continue;
      for (const id of ids) {
        const k = `${provider}:${id}`;
        if (seen.has(k)) continue;
        // Skip obvious non-chat endpoints returned by /models.
        if (/embed|tts|whisper|image|audio|rerank|moderation|veo|imagen|lyria/i.test(id)) continue;
        out.push(inferModelMeta(id, provider));
        seen.add(k);
      }
    }
    return out;
  }

  /**
   * Score and rank the pool for one task.
   * @returns {Array<{model:object, provider:string, key:string, score:number, why:string[]}>}
   */
  rank({ task = 'code', needsTools = true, minCtx = 0, includeCooldown = false } = {}) {
    const w = WEIGHTS[task] || WEIGHTS.code;
    const preferFree = this.config.preferFree !== false;
    const now = Date.now();
    const ranked = [];

    for (const m of this.pool()) {
      const cred = getKey(m.provider);
      if (!cred) continue;

      const why = [];
      let score = m.quality * w.quality + m.speed * w.speed;
      why.push(`quality ${m.quality} x${w.quality}, speed ${m.speed} x${w.speed}`);

      if (m.tags.includes(task)) { score += w.tag; why.push(`tagged "${task}"`); }
      if (preferFree && m.free) { score += FREE_BONUS; why.push('free tier'); }
      if (needsTools && !m.tools) { score -= TOOLS_PENALTY; why.push('no native tool calling'); }
      if (minCtx && m.ctx < minCtx) continue; // simply cannot hold the request
      if (minCtx && m.ctx >= minCtx * 4) { score += 0.5; why.push('roomy context'); }

      const h = healthOf(m.provider, m.id);
      if (h) {
        if (h.cooldownUntil > now) {
          if (!includeCooldown) continue;
          score -= 6;
          why.push(`cooling down after ${h.lastKind || 'failure'}`);
        }
        const total = h.ok + h.fail;
        if (total >= 3) {
          const reliability = h.ok / total;
          score += (reliability - 0.8) * 3;
          why.push(`reliability ${(reliability * 100).toFixed(0)}%`);
        }
        // Prefer models that have actually been fast for *this* user.
        if (h.avgMs && h.avgMs > 30000) { score -= 1; why.push('slow in practice'); }
      }

      // A model the user pinned always sorts first.
      if (this.pinned && (m.id === this.pinned || `${m.provider}:${m.id}` === this.pinned)) {
        score += 100;
        why.push('pinned by you');
      }

      ranked.push({ model: m, provider: m.provider, key: cred.key, score, why });
    }

    ranked.sort((a, b) => b.score - a.score);
    return ranked;
  }

  /** The single best candidate, or null when nothing is reachable. */
  pick(opts = {}) {
    const task = opts.task || 'code';
    const pinnedForTask = this.config.pins?.[task];
    if (pinnedForTask) {
      const m = findModel(pinnedForTask);
      if (m) {
        const cred = getKey(m.provider);
        if (cred) return { model: m, provider: m.provider, key: cred.key, score: 999, why: [`pinned for ${task}`] };
      }
    }
    const ranked = this.rank(opts);
    return ranked[0] || null;
  }

  /**
   * Run a completion with automatic failover.
   *
   * Tries the ranked candidates in order. A non-retryable failure (bad model
   * id, dead key) drops that model and moves on; a retryable one does the
   * same but the model keeps a shorter cooldown. Throws only when every
   * candidate has been exhausted.
   */
  async complete({
    messages, tools, task = 'code', stream = false, onDelta, onFailover,
    temperature, maxTokens, signal, maxAttempts = 8,
  }) {
    const needsTools = Boolean(tools?.length);
    const minCtx = estimateTokens(messages) + 2000;
    let candidates = this.rank({ task, needsTools, minCtx });

    if (!candidates.length) {
      // Nothing passed the filters - relax them rather than dead-ending.
      candidates = this.rank({ task, needsTools, minCtx: 0, includeCooldown: true });
    }
    if (!candidates.length) {
      throw new OllyError(
        'No usable model. Add a key with `/key <paste your key>` - a free Google AI Studio key at https://aistudio.google.com/apikey is the quickest start.',
        { kind: 'config' },
      );
    }

    const errors = [];
    const tried = new Set();
    // Providers whose key is rejected outright are dead for the whole turn -
    // there is no point walking through five of their models one by one.
    const deadProviders = new Set();

    for (const cand of candidates) {
      if (tried.size >= maxAttempts) break;
      const tag = `${cand.provider}:${cand.model.id}`;
      if (tried.has(tag)) continue;
      if (deadProviders.has(cand.provider)) continue;
      tried.add(tag);

      try {
        this.stats.calls += 1;
        const res = await chat({
          provider: cand.provider,
          key: cand.key,
          model: cand.model.id,
          messages,
          tools: cand.model.tools ? tools : undefined,
          stream,
          onDelta,
          temperature: temperature ?? this.config.temperature ?? 0.2,
          maxTokens,
          signal,
        });
        recordSuccess(cand.provider, cand.model.id, res.ms);
        this.lastPick = cand;
        this.stats.byModel[tag] = (this.stats.byModel[tag] || 0) + 1;
        return { ...res, pick: cand, attempts: tried.size, errors };
      } catch (e) {
        const kind = e instanceof OllyError ? e.kind : 'unknown';
        recordFailure(cand.provider, cand.model.id, kind);
        errors.push({ model: tag, kind, message: e.message });
        if (kind === 'auth' || kind === 'quota') deadProviders.add(cand.provider);
        this.stats.failovers += 1;
        onFailover?.({ from: tag, kind, message: e.message });
        // An aborted turn is the user's doing - stop, do not shop around.
        if (signal?.aborted) throw e;
      }
    }

    const detail = errors.map((e) => `  ${e.model}: [${e.kind}] ${e.message}`).join('\n');
    throw new OllyError(`All ${tried.size} candidate models failed.\n${detail}`, {
      kind: 'exhausted', body: errors,
    });
  }

  /** Human-readable routing table, for `/route`. */
  explain(task = 'code', limit = 12) {
    return this.rank({ task, includeCooldown: true }).slice(0, limit).map((r, i) => ({
      rank: i + 1,
      model: r.model.id,
      provider: r.provider,
      name: r.model.name,
      score: Number(r.score.toFixed(2)),
      free: r.model.free,
      tools: r.model.tools,
      ctx: r.model.ctx,
      why: r.why,
      health: healthOf(r.provider, r.model.id),
    }));
  }
}

/**
 * Rough token estimate. Deliberately cheap: ~3.6 chars/token is close enough
 * for choosing a context window and costs nothing.
 */
export function estimateTokens(messages) {
  let chars = 0;
  for (const m of messages || []) {
    if (typeof m.content === 'string') chars += m.content.length;
    else if (Array.isArray(m.content)) chars += JSON.stringify(m.content).length;
    for (const tc of m.tool_calls || []) chars += (tc.function?.arguments || '').length + 40;
  }
  return Math.ceil(chars / 3.6);
}

export { PROVIDERS, OllyError };
