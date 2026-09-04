/** Programmatic entry point, for embedding OllyAI in other tools. */
export { OmniRouter, classifyTask, estimateTokens } from './router/router.js';
export { Agent } from './core/agent.js';
export { parseKeys, parseKey, redact } from './router/keyparse.js';
export { chat, listModels, verifyKey, OllyError } from './router/chat.js';
export { PROVIDERS } from './router/providers.js';
export { CATALOG } from './router/catalog.js';
export { TOOLS, toolSchemas } from './tools/index.js';
export { ingestKeys, describeKeys, loadConfig, saveConfig } from './core/config.js';
