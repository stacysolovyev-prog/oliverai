/**
 * Universal API-key ingestion.
 *
 * OllyAI's promise is that you can paste a key *in any format* and it just
 * works: a bare token, `KEY=value`, an `export` line, a whole .env dump, a
 * JSON blob, a YAML fragment, a curl command, or a sentence like
 * "here is my key: xxx". This module turns any of that into a list of
 * { provider, key, confidence, source } records.
 *
 * Detection runs in three passes, most trustworthy first:
 *   1. shape    - the token's own prefix (`nvapi-`, `sk-or-v1-`, ...)
 *   2. context  - the variable name or JSON field it was found under
 *   3. probe    - an actual authenticated request, for anything still unknown
 */

/**
 * Known key shapes. `re` must be anchored to the whole token.
 * `weight` is the confidence when the shape alone matches.
 */
const SHAPES = [
  { provider: 'nvidia',      re: /^nvapi-[A-Za-z0-9_\-]{20,}$/,            weight: 0.99, label: 'NVIDIA NIM' },
  { provider: 'openrouter',  re: /^sk-or-v1-[A-Za-z0-9]{32,}$/,            weight: 0.99, label: 'OpenRouter' },
  { provider: 'openrouter',  re: /^sk-or-[A-Za-z0-9\-]{20,}$/,             weight: 0.90, label: 'OpenRouter' },
  { provider: 'anthropic',   re: /^sk-ant-[A-Za-z0-9_\-]{20,}$/,           weight: 0.99, label: 'Anthropic' },
  { provider: 'groq',        re: /^gsk_[A-Za-z0-9]{20,}$/,                 weight: 0.99, label: 'Groq' },
  { provider: 'cerebras',    re: /^csk-[A-Za-z0-9]{20,}$/,                 weight: 0.99, label: 'Cerebras' },
  { provider: 'google',      re: /^AIza[A-Za-z0-9_\-]{30,}$/,              weight: 0.99, label: 'Google AI Studio' },
  { provider: 'google',      re: /^AQ\.[A-Za-z0-9_\-]{20,}$/,              weight: 0.97, label: 'Google AI Studio' },
  { provider: 'huggingface', re: /^hf_[A-Za-z0-9]{20,}$/,                  weight: 0.99, label: 'Hugging Face' },
  { provider: 'together',    re: /^tgp_v1_[A-Za-z0-9_\-]{20,}$/,           weight: 0.99, label: 'Together AI' },
  { provider: 'perplexity',  re: /^pplx-[A-Za-z0-9]{20,}$/,                weight: 0.99, label: 'Perplexity' },
  { provider: 'fireworks',   re: /^fw_[A-Za-z0-9]{20,}$/,                  weight: 0.98, label: 'Fireworks AI' },
  { provider: 'xai',         re: /^xai-[A-Za-z0-9]{20,}$/,                 weight: 0.99, label: 'xAI' },
  { provider: 'replicate',   re: /^r8_[A-Za-z0-9]{20,}$/,                  weight: 0.98, label: 'Replicate' },
  { provider: 'github',      re: /^github_pat_[A-Za-z0-9_]{20,}$/,         weight: 0.99, label: 'GitHub (fine-grained PAT)' },
  { provider: 'github',      re: /^gh[posur]_[A-Za-z0-9]{30,}$/,           weight: 0.99, label: 'GitHub token' },
  { provider: 'gitlab',      re: /^glpat-[A-Za-z0-9_\-]{15,}$/,            weight: 0.98, label: 'GitLab token' },
  { provider: 'deepseek',    re: /^sk-[0-9a-f]{32}$/,                      weight: 0.70, label: 'DeepSeek' },
  { provider: 'openai',      re: /^sk-(proj|svcacct|admin)-[A-Za-z0-9_\-]{20,}$/, weight: 0.97, label: 'OpenAI' },
  { provider: 'openai',      re: /^sk-[A-Za-z0-9]{32,}$/,                  weight: 0.75, label: 'OpenAI' },
  { provider: 'mistral',     re: /^[A-Za-z0-9]{32}$/,                      weight: 0.30, label: 'Mistral' },
];

/**
 * Context hints: variable names, JSON fields and prose that identify a
 * provider even when the token itself is shapeless. Ordered most specific
 * first so that e.g. GITHUB_MODELS_TOKEN beats GITHUB_TOKEN.
 */
const CONTEXT_HINTS = [
  [/openrouter|omni.?rout|open.?rout/i, 'openrouter'],
  [/github.?models|models\.github|gh.?models/i, 'github-models'],
  [/nvidia|nvcf|\bnim\b|build\.nvidia/i, 'nvidia'],
  [/gemini|google.?ai|generativelanguage|aistudio|\bgoogle\b|\bgemma\b/i, 'google'],
  [/anthropic|claude/i, 'anthropic'],
  [/cerebras/i, 'cerebras'],
  [/\bgroq\b/i, 'groq'],
  [/hugging.?face|\bhf\b/i, 'huggingface'],
  [/together(\.?ai)?/i, 'together'],
  [/mistral|codestral/i, 'mistral'],
  [/deep.?seek/i, 'deepseek'],
  [/fireworks/i, 'fireworks'],
  [/perplexity|pplx/i, 'perplexity'],
  [/replicate/i, 'replicate'],
  [/\bx\.?ai\b|\bgrok\b/i, 'xai'],
  [/\bcohere\b/i, 'cohere'],
  [/gitlab/i, 'gitlab'],
  [/github|\bgh\b|\bgit\b/i, 'github'],
  [/openai|chatgpt|\bgpt\b/i, 'openai'],
  [/ollama|localhost:11434/i, 'ollama'],
];

/** Words that are never keys, even though they look tokenish. */
const STOPWORDS = new Set([
  'authorization', 'content-type', 'application', 'undefined', 'null', 'true', 'false',
  'your_api_key_here', 'xxxxxxxxxxxx', 'changeme', 'placeholder', 'example',
]);

/** A token must clear these bars before we consider it a credential at all. */
function looksLikeSecret(tok) {
  if (!tok || tok.length < 16 || tok.length > 400) return false;
  if (STOPWORDS.has(tok.toLowerCase())) return false;
  if (/^(https?|ftp):\/\//i.test(tok)) return false;
  // Real provider keys never contain URL/path punctuation - this rejects
  // fragments accidentally sliced out of URLs and curl command lines.
  if (/[/?&@\\=]/.test(tok)) return false;
  // Reject natural-language: real keys have digits or mixed case and no spaces.
  if (/\s/.test(tok)) return false;
  const hasDigit = /\d/.test(tok);
  const hasUpper = /[A-Z]/.test(tok);
  const hasLower = /[a-z]/.test(tok);
  if (!hasDigit && !(hasUpper && hasLower)) return false;
  // Reject obvious placeholders such as "xxxx-xxxx" or "<your-key>".
  if (/^[x*.<>\-_]+$/i.test(tok)) return false;
  return true;
}

/** Shannon entropy per character - real keys sit well above prose. */
export function entropy(s) {
  const freq = new Map();
  for (const ch of s) freq.set(ch, (freq.get(ch) || 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** Match a token against known shapes; returns the best match or null. */
export function matchShape(token) {
  let best = null;
  for (const s of SHAPES) {
    if (s.re.test(token) && (!best || s.weight > best.weight)) best = s;
  }
  return best;
}

/** Resolve a provider from surrounding text (variable name, JSON key, prose). */
export function matchContext(context) {
  if (!context) return null;
  for (const [re, provider] of CONTEXT_HINTS) {
    if (re.test(context)) return provider;
  }
  return null;
}

/**
 * Pull out every (token, context) pair we can find in an arbitrary blob.
 * `context` is whatever text preceded the token on its line - the variable
 * name, JSON field, curl header, or prose lead-in.
 */
function extractCandidates(text) {
  const found = [];
  const push = (token, context, how) => {
    token = String(token).trim().replace(/^["'`]|["'`,;]+$/g, '').trim();
    if (looksLikeSecret(token)) found.push({ token, context: context || '', how });
  };

  // 1. KEY=value / KEY: value / "key": "value" / export KEY=value
  const assign = /(?:^|[\s,{])(?:export\s+)?["']?([A-Za-z_][A-Za-z0-9_.\-]{2,60})["']?\s*[:=]\s*["']?([^\s"',}\]]+)["']?/gm;
  for (const m of text.matchAll(assign)) push(m[2], m[1], 'assignment');

  // 2. Authorization / Bearer headers, including inside curl commands.
  const bearer = /(?:authorization|x-api-key|api-key|x-goog-api-key)\s*[:=]\s*["']?(?:Bearer\s+|Token\s+)?([^\s"'\\]+)/gi;
  for (const m of text.matchAll(bearer)) push(m[1], m[0], 'header');

  // 3. ?key=... in a URL (Google's native style).
  const query = /[?&](?:key|api_key|apikey|token)=([^\s&"'#]+)/gi;
  for (const m of text.matchAll(query)) push(m[1], m[0], 'url');

  // 4. Bare tokens matching a known prefix, anywhere in the text.
  const prefixed = /\b(?:nvapi-|sk-or-v1-|sk-or-|sk-ant-|sk-proj-|sk-svcacct-|sk-admin-|sk-|gsk_|csk-|AIza|AQ\.|hf_|tgp_v1_|pplx-|fw_|xai-|r8_|github_pat_|ghp_|gho_|ghu_|ghs_|ghr_|glpat-)[A-Za-z0-9_.\-]{16,}/g;
  for (const m of text.matchAll(prefixed)) {
    const idx = m.index ?? 0;
    push(m[0], text.slice(Math.max(0, idx - 60), idx), 'prefix');
  }

  // 5. Last resort: a long high-entropy standalone token (e.g. Mistral keys).
  const bare = /(?:^|\s)([A-Za-z0-9_\-]{24,120})(?=\s|$)/gm;
  for (const m of text.matchAll(bare)) {
    if (entropy(m[1]) >= 3.2) {
      const idx = m.index ?? 0;
      push(m[1], text.slice(Math.max(0, idx - 60), idx), 'bare');
    }
  }

  // De-duplicate by token, keeping the richest context we saw for it.
  const byToken = new Map();
  for (const f of found) {
    const prev = byToken.get(f.token);
    if (!prev || (f.context.length > prev.context.length)) byToken.set(f.token, f);
  }
  return [...byToken.values()];
}

/**
 * Parse arbitrary pasted text into credential records.
 * @returns {Array<{provider:string|null, key:string, confidence:number, label:string, reasons:string[], needsProbe:boolean}>}
 */
export function parseKeys(text) {
  if (!text || typeof text !== 'string') return [];
  const candidates = extractCandidates(text);
  const results = [];

  for (const { token, context, how } of candidates) {
    const reasons = [];
    const shape = matchShape(token);
    const ctx = matchContext(context);

    let provider = null;
    let confidence = 0;
    let label = 'Unknown';

    if (shape) {
      provider = shape.provider;
      confidence = shape.weight;
      label = shape.label;
      reasons.push(`token shape matches ${shape.label}`);
    }

    if (ctx) {
      // A GitHub-shaped token named GITHUB_MODELS_TOKEN is an inference key.
      if (ctx === 'github-models' && (!provider || provider === 'github')) {
        provider = 'github-models';
        label = 'GitHub Models';
        confidence = Math.max(confidence, 0.95);
        reasons.push('named as a GitHub Models inference token');
      } else if (!provider) {
        provider = ctx;
        confidence = 0.6;
        label = ctx;
        reasons.push(`named after ${ctx}`);
      } else if (ctx === provider) {
        confidence = Math.min(0.99, confidence + 0.15);
        reasons.push('name agrees with token shape');
      } else if (confidence < 0.9) {
        // Shape was a weak guess and the name disagrees - trust the name.
        provider = ctx;
        confidence = 0.65;
        label = ctx;
        reasons.push(`name (${ctx}) overrode weak shape guess`);
      }
    }

    if (!provider) {
      reasons.push('no recognizable shape or name; will probe providers live');
    }

    results.push({
      provider,
      key: token,
      confidence: Number(confidence.toFixed(2)),
      label,
      reasons,
      how,
      needsProbe: !provider || confidence < 0.7,
    });
  }

  // Strongest first so the caller can take the best interpretation.
  results.sort((a, b) => b.confidence - a.confidence);
  return results;
}

/** Convenience: the single best credential in a blob, or null. */
export function parseKey(text) {
  return parseKeys(text)[0] || null;
}

/** Mask a secret for display: keeps the prefix so you can tell keys apart. */
export function redact(key) {
  if (!key) return '';
  const s = String(key);
  if (s.length <= 12) return s.slice(0, 2) + '*'.repeat(Math.max(0, s.length - 2));
  const m = s.match(/^([A-Za-z_]+[-_.])/);
  const head = m ? m[1] + s.slice(m[1].length, m[1].length + 4) : s.slice(0, 6);
  return `${head}${'*'.repeat(6)}${s.slice(-4)}`;
}
