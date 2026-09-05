/**
 * Provider registry.
 *
 * Nearly every provider here speaks the OpenAI /chat/completions dialect, so
 * one client covers them all (see chat.js). The exceptions declare `api:
 * 'anthropic'` and get translated. Each entry also records how to discover
 * models and where a user signs up for a free key.
 */

export const PROVIDERS = {
  google: {
    id: 'google',
    label: 'Google AI Studio (Gemini)',
    api: 'openai',
    base: 'https://generativelanguage.googleapis.com/v1beta/openai',
    // Use the OpenAI-compatible /models path: the native v1beta/models
    // endpoint rejects `Authorization: Bearer` and wants ?key= instead.
    auth: 'bearer',
    envVars: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_AI_API_KEY'],
    signup: 'https://aistudio.google.com/apikey',
    free: true,
    notes: 'Generous free tier. Strong tool-calling and 1M-token context.',
  },
  nvidia: {
    id: 'nvidia',
    label: 'NVIDIA NIM',
    api: 'openai',
    base: 'https://integrate.api.nvidia.com/v1',
    auth: 'bearer',
    envVars: ['NVIDIA_API_KEY', 'NVIDIA_NIM_API_KEY', 'NVCF_API_KEY'],
    signup: 'https://build.nvidia.com',
    free: true,
    notes: 'Free credits across many open-weight models (Llama, Qwen, DeepSeek, Nemotron).',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    api: 'openai',
    base: 'https://openrouter.ai/api/v1',
    auth: 'bearer',
    envVars: ['OPENROUTER_API_KEY', 'OPENROUTER_KEY'],
    signup: 'https://openrouter.ai/keys',
    free: true,
    headers: {
      'HTTP-Referer': 'https://github.com/ollyai/ollyai',
      'X-Title': 'OllyAI',
    },
    notes: 'Aggregator. Models suffixed `:free` cost nothing.',
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    api: 'openai',
    base: 'https://api.groq.com/openai/v1',
    auth: 'bearer',
    envVars: ['GROQ_API_KEY'],
    signup: 'https://console.groq.com/keys',
    free: true,
    notes: 'Extremely fast inference on open-weight models. Free tier with rate limits.',
  },
  cerebras: {
    id: 'cerebras',
    label: 'Cerebras',
    api: 'openai',
    base: 'https://api.cerebras.ai/v1',
    auth: 'bearer',
    envVars: ['CEREBRAS_API_KEY'],
    signup: 'https://cloud.cerebras.ai',
    free: true,
    notes: 'The fastest tokens/sec available on a free tier.',
  },
  'github-models': {
    id: 'github-models',
    label: 'GitHub Models',
    api: 'openai',
    base: 'https://models.github.ai/inference',
    auth: 'bearer',
    // Deliberately not GITHUB_TOKEN: that is usually CI's git credential, not
    // an inference key, and picking it up makes the provider look configured
    // when no model can actually be served.
    envVars: ['GITHUB_MODELS_TOKEN'],
    signup: 'https://github.com/marketplace/models',
    free: true,
    notes: 'Any GitHub PAT unlocks a free inference tier.',
  },
  mistral: {
    id: 'mistral',
    label: 'Mistral AI',
    api: 'openai',
    base: 'https://api.mistral.ai/v1',
    auth: 'bearer',
    envVars: ['MISTRAL_API_KEY'],
    signup: 'https://console.mistral.ai/api-keys',
    free: true,
    notes: 'Free experiment tier; strong code models (Codestral).',
  },
  together: {
    id: 'together',
    label: 'Together AI',
    api: 'openai',
    base: 'https://api.together.xyz/v1',
    auth: 'bearer',
    envVars: ['TOGETHER_API_KEY'],
    signup: 'https://api.together.ai/settings/api-keys',
    free: true,
    notes: 'Free tier on several open models.',
  },
  huggingface: {
    id: 'huggingface',
    label: 'Hugging Face Inference',
    api: 'openai',
    base: 'https://router.huggingface.co/v1',
    auth: 'bearer',
    envVars: ['HF_TOKEN', 'HUGGINGFACE_API_KEY', 'HUGGINGFACEHUB_API_TOKEN'],
    signup: 'https://huggingface.co/settings/tokens',
    free: true,
    notes: 'Routes to open-weight models hosted across HF partners.',
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    api: 'openai',
    base: 'https://api.deepseek.com/v1',
    auth: 'bearer',
    envVars: ['DEEPSEEK_API_KEY'],
    signup: 'https://platform.deepseek.com/api_keys',
    free: false,
    notes: 'Very cheap rather than free; excellent at code.',
  },
  ollama: {
    id: 'ollama',
    label: 'Ollama (local)',
    api: 'openai',
    get base() { return `${process.env.OLLAMA_HOST || 'http://127.0.0.1:11434'}/v1`; },
    auth: 'none',
    envVars: [],
    signup: 'https://ollama.com/download',
    free: true,
    local: true,
    notes: 'Runs open models on your own machine. No key, no limits.',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    api: 'openai',
    base: 'https://api.openai.com/v1',
    auth: 'bearer',
    envVars: ['OPENAI_API_KEY'],
    signup: 'https://platform.openai.com/api-keys',
    free: false,
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    api: 'anthropic',
    base: 'https://api.anthropic.com/v1',
    auth: 'x-api-key',
    envVars: ['ANTHROPIC_API_KEY'],
    signup: 'https://console.anthropic.com/settings/keys',
    free: false,
  },
  xai: {
    id: 'xai',
    label: 'xAI (Grok)',
    api: 'openai',
    base: 'https://api.x.ai/v1',
    auth: 'bearer',
    envVars: ['XAI_API_KEY'],
    signup: 'https://console.x.ai',
    free: false,
  },
  fireworks: {
    id: 'fireworks',
    label: 'Fireworks AI',
    api: 'openai',
    base: 'https://api.fireworks.ai/inference/v1',
    auth: 'bearer',
    envVars: ['FIREWORKS_API_KEY'],
    signup: 'https://fireworks.ai/api-keys',
    free: false,
  },
  perplexity: {
    id: 'perplexity',
    label: 'Perplexity',
    api: 'openai',
    base: 'https://api.perplexity.ai',
    auth: 'bearer',
    envVars: ['PERPLEXITY_API_KEY'],
    signup: 'https://www.perplexity.ai/settings/api',
    free: false,
  },

  // --- Non-inference providers: used for git hosting, not for models. ---
  github: {
    id: 'github',
    label: 'GitHub',
    kind: 'scm',
    base: 'https://api.github.com',
    envVars: ['GITHUB_TOKEN', 'GH_TOKEN'],
    signup: 'https://github.com/settings/tokens',
  },
  gitlab: {
    id: 'gitlab',
    label: 'GitLab',
    kind: 'scm',
    base: 'https://gitlab.com/api/v4',
    envVars: ['GITLAB_TOKEN'],
    signup: 'https://gitlab.com/-/user_settings/personal_access_tokens',
  },
  replicate: { id: 'replicate', label: 'Replicate', kind: 'other', envVars: ['REPLICATE_API_TOKEN'], signup: 'https://replicate.com/account/api-tokens' },
  cohere: { id: 'cohere', label: 'Cohere', kind: 'other', envVars: ['COHERE_API_KEY'], signup: 'https://dashboard.cohere.com/api-keys' },
};

/** Providers that can actually serve chat completions. */
export function inferenceProviders() {
  return Object.values(PROVIDERS).filter((p) => !p.kind || p.kind === 'inference');
}

export function getProvider(id) {
  return PROVIDERS[id] || null;
}

/** Build the auth headers for a provider + key. */
export function authHeaders(provider, key) {
  const p = typeof provider === 'string' ? getProvider(provider) : provider;
  if (!p) return {};
  const h = { 'Content-Type': 'application/json', ...(p.headers || {}) };
  if (p.auth === 'none' || !key) return h;
  if (p.auth === 'x-api-key') {
    h['x-api-key'] = key;
    h['anthropic-version'] = '2023-06-01';
  } else {
    h.Authorization = `Bearer ${key}`;
  }
  return h;
}

/** Discover a key for `providerId` from the process environment. */
export function keyFromEnv(providerId) {
  const p = getProvider(providerId);
  if (!p) return null;
  for (const v of p.envVars || []) {
    if (process.env[v]) return { key: process.env[v], via: v };
  }
  return null;
}
