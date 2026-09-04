/**
 * Curated model catalog.
 *
 * Scores are 0-10 and deliberately hand-tuned rather than scraped: the router
 * needs a stable opinion about "which of these is better at editing code" that
 * a /models endpoint cannot give it. Availability is discovered at runtime
 * (see router.refresh) and merged over this list.
 *
 * tags describe what a model is *good for*:
 *   plan  - decomposition, architecture, hard debugging
 *   code  - writing and editing source, following tool protocols
 *   fast  - cheap classification, summarising, routing decisions
 *   long  - very large context windows
 *   vision- image input
 */

/** @type {Array<{id:string,provider:string,name:string,ctx:number,quality:number,speed:number,tools:boolean,free:boolean,tags:string[]}>} */
export const CATALOG = [
  // ---------------- Google AI Studio (the default brain) ----------------
  { id: 'gemini-3.8-flash',       provider: 'google', name: 'Gemini 3.8 Flash',      ctx: 1048576, quality: 9.4, speed: 9.3, tools: true, free: true, tags: ['plan', 'code', 'long', 'vision'] },
  { id: 'gemini-3.6-flash',       provider: 'google', name: 'Gemini 3.6 Flash',      ctx: 1048576, quality: 9.1, speed: 6.2, tools: true, free: true, tags: ['plan', 'code', 'long', 'vision'] },
  { id: 'gemini-3.7-flash',       provider: 'google', name: 'Gemini 3.7 Flash',      ctx: 1048576, quality: 9.2, speed: 6.4, tools: true, free: true, tags: ['plan', 'code', 'long'] },
  { id: 'gemini-3.5-flash',       provider: 'google', name: 'Gemini 3.5 Flash',      ctx: 1048576, quality: 8.8, speed: 6.5, tools: true, free: true, tags: ['code', 'long', 'vision'] },
  { id: 'gemini-3.1-pro-preview', provider: 'google', name: 'Gemini 3.1 Pro',        ctx: 1048576, quality: 9.6, speed: 6.0, tools: true, free: true, tags: ['plan', 'code', 'long', 'vision'] },
  { id: 'gemini-3.5-flash-lite',  provider: 'google', name: 'Gemini 3.5 Flash Lite', ctx: 1048576, quality: 7.6, speed: 3.0, tools: true, free: true, tags: ['fast', 'long'] },
  { id: 'gemini-3.1-flash-lite',  provider: 'google', name: 'Gemini 3.1 Flash Lite', ctx: 1048576, quality: 7.3, speed: 9.9, tools: true, free: true, tags: ['fast', 'long'] },
  { id: 'gemma-4-31b-it',         provider: 'google', name: 'Gemma 4 31B',           ctx: 262144,  quality: 7.4, speed: 8.0, tools: false, free: true, tags: ['fast'] },

  // ---------------- NVIDIA NIM (free open-weight models) ----------------
  { id: 'deepseek-ai/deepseek-r1',                       provider: 'nvidia', name: 'DeepSeek R1',            ctx: 128000, quality: 9.2, speed: 5.0, tools: false, free: true, tags: ['plan'] },
  { id: 'deepseek-ai/deepseek-v3.1',                     provider: 'nvidia', name: 'DeepSeek V3.1',          ctx: 128000, quality: 9.0, speed: 6.5, tools: true,  free: true, tags: ['plan', 'code'] },
  { id: 'qwen/qwen3-coder-480b-a35b-instruct',           provider: 'nvidia', name: 'Qwen3 Coder 480B',       ctx: 262144, quality: 9.1, speed: 6.0, tools: true,  free: true, tags: ['code', 'long'] },
  { id: 'qwen/qwen2.5-coder-32b-instruct',               provider: 'nvidia', name: 'Qwen2.5 Coder 32B',      ctx: 32768,  quality: 8.2, speed: 7.5, tools: true,  free: true, tags: ['code'] },
  { id: 'meta/llama-3.3-70b-instruct',                   provider: 'nvidia', name: 'Llama 3.3 70B',          ctx: 128000, quality: 8.3, speed: 7.0, tools: true,  free: true, tags: ['code', 'plan'] },
  { id: 'meta/llama-4-maverick-17b-128e-instruct',       provider: 'nvidia', name: 'Llama 4 Maverick',       ctx: 1048576, quality: 8.6, speed: 7.5, tools: true, free: true, tags: ['code', 'long', 'vision'] },
  { id: 'nvidia/llama-3.3-nemotron-super-49b-v1',        provider: 'nvidia', name: 'Nemotron Super 49B',     ctx: 128000, quality: 8.4, speed: 7.2, tools: true,  free: true, tags: ['plan', 'code'] },
  { id: 'mistralai/codestral-22b-instruct-v0.1',         provider: 'nvidia', name: 'Codestral 22B',          ctx: 32768,  quality: 7.9, speed: 8.2, tools: false, free: true, tags: ['code'] },

  // ---------------- Groq (fast, free tier) ----------------
  { id: 'moonshotai/kimi-k2-instruct',      provider: 'groq', name: 'Kimi K2',            ctx: 131072, quality: 8.9, speed: 9.2, tools: true, free: true, tags: ['code', 'plan'] },
  { id: 'llama-3.3-70b-versatile',          provider: 'groq', name: 'Llama 3.3 70B',      ctx: 131072, quality: 8.3, speed: 9.5, tools: true, free: true, tags: ['code', 'fast'] },
  { id: 'openai/gpt-oss-120b',              provider: 'groq', name: 'GPT-OSS 120B',       ctx: 131072, quality: 8.7, speed: 9.0, tools: true, free: true, tags: ['plan', 'code'] },
  { id: 'openai/gpt-oss-20b',               provider: 'groq', name: 'GPT-OSS 20B',        ctx: 131072, quality: 7.8, speed: 9.7, tools: true, free: true, tags: ['fast', 'code'] },
  { id: 'qwen/qwen3-32b',                   provider: 'groq', name: 'Qwen3 32B',          ctx: 131072, quality: 8.0, speed: 9.3, tools: true, free: true, tags: ['code', 'fast'] },

  // ---------------- Cerebras (fastest free tier) ----------------
  { id: 'qwen-3-coder-480b',        provider: 'cerebras', name: 'Qwen3 Coder 480B', ctx: 131072, quality: 9.1, speed: 9.8, tools: true, free: true, tags: ['code', 'plan'] },
  { id: 'llama-3.3-70b',            provider: 'cerebras', name: 'Llama 3.3 70B',    ctx: 65536,  quality: 8.3, speed: 9.9, tools: true, free: true, tags: ['code', 'fast'] },
  { id: 'gpt-oss-120b',             provider: 'cerebras', name: 'GPT-OSS 120B',     ctx: 131072, quality: 8.7, speed: 9.6, tools: true, free: true, tags: ['plan', 'code'] },

  // ---------------- OpenRouter free pool ----------------
  { id: 'deepseek/deepseek-r1:free',                     provider: 'openrouter', name: 'DeepSeek R1 (free)',      ctx: 128000, quality: 9.2, speed: 4.5, tools: false, free: true, tags: ['plan'] },
  { id: 'deepseek/deepseek-chat-v3.1:free',              provider: 'openrouter', name: 'DeepSeek V3.1 (free)',    ctx: 128000, quality: 9.0, speed: 6.0, tools: true,  free: true, tags: ['plan', 'code'] },
  { id: 'qwen/qwen3-coder:free',                         provider: 'openrouter', name: 'Qwen3 Coder (free)',      ctx: 262144, quality: 8.9, speed: 6.5, tools: true,  free: true, tags: ['code', 'long'] },
  { id: 'meta-llama/llama-3.3-70b-instruct:free',        provider: 'openrouter', name: 'Llama 3.3 70B (free)',    ctx: 128000, quality: 8.3, speed: 6.5, tools: true,  free: true, tags: ['code'] },
  { id: 'mistralai/mistral-small-3.2-24b-instruct:free', provider: 'openrouter', name: 'Mistral Small 3.2 (free)', ctx: 96000, quality: 7.7, speed: 7.5, tools: true, free: true, tags: ['fast', 'code'] },
  { id: 'google/gemma-3-27b-it:free',                    provider: 'openrouter', name: 'Gemma 3 27B (free)',      ctx: 96000,  quality: 7.5, speed: 7.8, tools: false, free: true, tags: ['fast'] },

  // ---------------- GitHub Models (free with any PAT) ----------------
  { id: 'openai/gpt-4o-mini',    provider: 'github-models', name: 'GPT-4o mini',   ctx: 128000, quality: 7.9, speed: 8.8, tools: true, free: true, tags: ['fast', 'code'] },
  { id: 'openai/gpt-4.1',        provider: 'github-models', name: 'GPT-4.1',       ctx: 1048576, quality: 9.0, speed: 7.0, tools: true, free: true, tags: ['plan', 'code', 'long'] },
  { id: 'meta/Llama-3.3-70B-Instruct', provider: 'github-models', name: 'Llama 3.3 70B', ctx: 128000, quality: 8.3, speed: 7.5, tools: true, free: true, tags: ['code'] },

  // ---------------- Mistral ----------------
  { id: 'codestral-latest',      provider: 'mistral', name: 'Codestral',       ctx: 256000, quality: 8.4, speed: 8.5, tools: true, free: true, tags: ['code', 'long'] },
  { id: 'mistral-large-latest',  provider: 'mistral', name: 'Mistral Large',   ctx: 131072, quality: 8.6, speed: 7.0, tools: true, free: false, tags: ['plan', 'code'] },
  { id: 'mistral-small-latest',  provider: 'mistral', name: 'Mistral Small',   ctx: 131072, quality: 7.7, speed: 9.0, tools: true, free: true, tags: ['fast'] },

  // ---------------- Together ----------------
  { id: 'Qwen/Qwen2.5-Coder-32B-Instruct',              provider: 'together', name: 'Qwen2.5 Coder 32B', ctx: 32768, quality: 8.2, speed: 7.8, tools: true, free: true, tags: ['code'] },
  { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free', provider: 'together', name: 'Llama 3.3 70B Free', ctx: 128000, quality: 8.3, speed: 8.0, tools: true, free: true, tags: ['code', 'fast'] },

  // ---------------- Hugging Face router ----------------
  { id: 'Qwen/Qwen3-Coder-480B-A35B-Instruct', provider: 'huggingface', name: 'Qwen3 Coder 480B', ctx: 262144, quality: 9.0, speed: 6.0, tools: true, free: true, tags: ['code', 'long'] },
  { id: 'deepseek-ai/DeepSeek-V3.1',           provider: 'huggingface', name: 'DeepSeek V3.1',    ctx: 128000, quality: 9.0, speed: 5.5, tools: true, free: true, tags: ['plan', 'code'] },

  // ---------------- Paid providers, only used if you add those keys ----------------
  { id: 'deepseek-chat',     provider: 'deepseek',  name: 'DeepSeek Chat',   ctx: 128000, quality: 9.0, speed: 7.5, tools: true, free: false, tags: ['plan', 'code'] },
  { id: 'deepseek-reasoner', provider: 'deepseek',  name: 'DeepSeek R1',     ctx: 128000, quality: 9.3, speed: 5.0, tools: true, free: false, tags: ['plan'] },
  { id: 'gpt-4.1',           provider: 'openai',    name: 'GPT-4.1',         ctx: 1048576, quality: 9.0, speed: 7.5, tools: true, free: false, tags: ['plan', 'code', 'long'] },
  { id: 'gpt-4.1-mini',      provider: 'openai',    name: 'GPT-4.1 mini',    ctx: 1048576, quality: 8.0, speed: 9.0, tools: true, free: false, tags: ['fast', 'code'] },
  { id: 'claude-sonnet-4-5', provider: 'anthropic', name: 'Claude Sonnet 4.5', ctx: 200000, quality: 9.5, speed: 7.5, tools: true, free: false, tags: ['plan', 'code'] },
  { id: 'grok-4-fast',       provider: 'xai',       name: 'Grok 4 Fast',     ctx: 2000000, quality: 8.8, speed: 8.5, tools: true, free: false, tags: ['plan', 'code', 'long'] },
];

/** Every model we know about for a given provider. */
export function modelsFor(providerId) {
  return CATALOG.filter((m) => m.provider === providerId);
}

export function findModel(ref) {
  if (!ref) return null;
  // Accept "provider/model" as well as a bare model id.
  const slash = ref.indexOf(':');
  if (slash > 0) {
    const [p, ...rest] = ref.split(':');
    const exact = CATALOG.find((m) => m.provider === p && m.id === rest.join(':'));
    if (exact) return exact;
  }
  return CATALOG.find((m) => m.id === ref) || CATALOG.find((m) => m.name === ref) || null;
}

/**
 * Heuristics used when a provider serves a model we have no curated entry
 * for (discovered live from /models). Keeps unknown models usable but ranked
 * below anything we have actually vetted.
 */
export function inferModelMeta(id, providerId) {
  const s = id.toLowerCase();
  const tags = [];
  let quality = 6.5;
  let speed = 7.0;

  if (/coder|code|codestral/.test(s)) { tags.push('code'); quality += 0.8; }
  if (/r1|reason|think|opus|pro\b/.test(s)) { tags.push('plan'); quality += 0.9; speed -= 1.5; }
  if (/mini|lite|small|flash|8b|7b|4b|3b|1b/.test(s)) { tags.push('fast'); speed += 1.5; quality -= 0.6; }
  if (/70b|72b|120b|405b|480b|large|max/.test(s)) { quality += 0.7; speed -= 1.0; }
  if (/vision|vl\b|image|multimodal/.test(s)) tags.push('vision');
  if (!tags.length) tags.push('code');

  return {
    id,
    provider: providerId,
    name: id,
    ctx: 32768,
    quality: Math.max(1, Math.min(10, quality)),
    speed: Math.max(1, Math.min(10, speed)),
    tools: true,
    free: /:free$/.test(s),
    tags,
    discovered: true,
  };
}
