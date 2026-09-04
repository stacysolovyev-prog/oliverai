/**
 * Persistent configuration and the key store.
 *
 * Keys live in ~/.ollyai/keys.json with 0600 permissions and are never
 * written into a project directory. Environment variables are consulted as a
 * fallback so CI and containers work without a stored file.
 */

import fs from 'node:fs';
import { paths, ensureHome, readJson, writeJson } from '../util/paths.js';
import { PROVIDERS, keyFromEnv } from '../router/providers.js';
import { parseKeys, redact } from '../router/keyparse.js';

const DEFAULT_CONFIG = {
  version: 1,
  // Model selection: 'auto' lets OmniRoute choose per turn.
  model: 'auto',
  // Prefer free/open models before anything billable.
  preferFree: true,
  // 'ask' | 'auto' | 'readonly' - how much OllyAI may do without confirming.
  approval: 'ask',
  // Cap on agent tool-call iterations per user turn.
  maxSteps: 40,
  temperature: 0.2,
  // Repos OllyAI knows how to work on.
  repos: [],
  // Per-task-class model pins, e.g. { plan: 'gemini-3.1-pro-preview' }
  pins: {},
  telemetry: false,
};

let _config = null;
let _keys = null;

export function loadConfig(force = false) {
  if (_config && !force) return _config;
  ensureHome();
  _config = { ...DEFAULT_CONFIG, ...(readJson(paths.config, {}) || {}) };
  return _config;
}

export function saveConfig(patch = {}) {
  const cfg = { ...loadConfig(), ...patch };
  _config = cfg;
  writeJson(paths.config, cfg, 0o600);
  return cfg;
}

export function loadKeys(force = false) {
  if (_keys && !force) return _keys;
  ensureHome();
  _keys = readJson(paths.keys, {}) || {};
  return _keys;
}

function persistKeys() {
  writeJson(paths.keys, _keys || {}, 0o600);
}

/**
 * Resolve the active key for a provider: stored key first, then environment.
 * @returns {{key:string, source:string}|null}
 */
export function getKey(providerId) {
  const store = loadKeys();
  const entry = store[providerId];
  if (entry && entry.key) return { key: entry.key, source: 'stored' };
  const env = keyFromEnv(providerId);
  if (env) return { key: env.key, source: `env:${env.via}` };
  // Ollama needs no credential at all.
  const p = PROVIDERS[providerId];
  if (p && p.auth === 'none') return { key: '', source: 'local' };
  return null;
}

export function setKey(providerId, key, meta = {}) {
  loadKeys();
  _keys[providerId] = {
    key,
    addedAt: new Date().toISOString(),
    ...meta,
  };
  persistKeys();
  return _keys[providerId];
}

export function removeKey(providerId) {
  loadKeys();
  const had = Boolean(_keys[providerId]);
  delete _keys[providerId];
  persistKeys();
  return had;
}

/** Every provider we currently hold a usable credential for. */
export function configuredProviders() {
  return Object.keys(PROVIDERS).filter((id) => getKey(id) !== null);
}

/**
 * Take a blob of pasted text, work out which providers it contains keys for,
 * and store them. This is what powers `/key <paste anything>`.
 *
 * @param {string} blob
 * @param {{verify?: (providerId:string, key:string)=>Promise<boolean>, minConfidence?: number}} opts
 * @returns {Promise<Array<{provider:string,key:string,confidence:number,stored:boolean,verified:boolean|null,reason:string}>>}
 */
export async function ingestKeys(blob, opts = {}) {
  const { verify = null, minConfidence = 0.5 } = opts;
  const parsed = parseKeys(blob);
  const out = [];
  const seenProvider = new Set();

  for (const cand of parsed) {
    if (!cand.provider) {
      out.push({ ...cand, stored: false, verified: null, reason: 'could not identify a provider' });
      continue;
    }
    if (cand.confidence < minConfidence) {
      out.push({ ...cand, stored: false, verified: null, reason: `confidence too low (${cand.confidence})` });
      continue;
    }
    // Within one paste, the first (highest-confidence) key per provider wins.
    if (seenProvider.has(cand.provider)) {
      out.push({ ...cand, stored: false, verified: null, reason: 'a stronger key for this provider was in the same paste' });
      continue;
    }

    let verified = null;
    if (verify) {
      try { verified = await verify(cand.provider, cand.key); }
      catch { verified = false; }
      if (verified === false) {
        out.push({ ...cand, stored: false, verified: false, reason: 'the provider rejected this key' });
        continue;
      }
    }

    seenProvider.add(cand.provider);
    setKey(cand.provider, cand.key, {
      confidence: cand.confidence,
      detectedAs: cand.label,
      verified: verified === true,
    });
    out.push({ ...cand, stored: true, verified, reason: 'stored' });
  }
  return out;
}

/** A redacted view of the key store, safe to print. */
export function describeKeys() {
  const store = loadKeys();
  const rows = [];
  for (const id of Object.keys(PROVIDERS)) {
    const resolved = getKey(id);
    if (!resolved) continue;
    const p = PROVIDERS[id];
    rows.push({
      provider: id,
      label: p.label,
      kind: p.kind || 'inference',
      masked: p.auth === 'none' ? '(no key needed)' : redact(resolved.key),
      source: resolved.source,
      verified: store[id]?.verified ?? null,
      free: Boolean(p.free),
    });
  }
  return rows;
}

/** Wipe every stored credential. */
export function clearAllKeys() {
  _keys = {};
  try { fs.rmSync(paths.keys, { force: true }); } catch { /* already gone */ }
  return true;
}

export { redact };
