/**
 * The agent loop.
 *
 * One user turn becomes: build a transcript, ask OmniRoute for a completion
 * with tools attached, run whatever tools the model asked for, feed the
 * results back, and repeat until the model stops calling tools or we hit the
 * step budget. Every model call goes through the router, so a rate limit
 * mid-task silently moves to another model instead of failing the turn.
 */

import path from 'node:path';
import fs from 'node:fs';
import { TOOL_MAP, toolSchemas, safeToolSchemas } from '../tools/index.js';
import { safeJson } from '../router/chat.js';
import { classifyTask, estimateTokens } from '../router/router.js';

const SYSTEM = `You are OllyAI, a terminal coding agent. You work directly in the user's repository.

How you work:
- Investigate before you edit. Use list_dir, grep and read_file to understand the code first.
- Make the smallest change that does the job. Match the surrounding style, naming and comment density.
- Use edit_file for changes to existing files; write_file only for new files or full rewrites.
- After changing code, verify it: run the project's tests, linter or a syntax check with the bash tool.
- Use the git tool for git. Never commit or push unless the user asked you to.
- When the task is done, call finish with a short summary of what changed.

Style:
- Be concise. Do not narrate what you are about to do; just do it, then report.
- If the request is ambiguous in a way that changes the work, ask before building.
- Never invent file contents. If you have not read a file, read it.`;

/** A compact description of the workspace, given to the model up front. */
function workspaceContext(root) {
  const lines = [`Workspace: ${root}`];
  try {
    const entries = fs.readdirSync(root, { withFileTypes: true })
      .filter((e) => !e.name.startsWith('.') || e.name === '.github')
      .slice(0, 60)
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
    lines.push(`Top level: ${entries.join(', ') || '(empty)'}`);
  } catch { /* unreadable root is reported by the tools instead */ }

  for (const f of ['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml']) {
    const p = path.join(root, f);
    if (!fs.existsSync(p)) continue;
    try {
      const txt = fs.readFileSync(p, 'utf8');
      lines.push(`${f}: ${txt.slice(0, 600)}`);
    } catch { /* ignore */ }
    break;
  }
  // Project conventions, if the repo documents them.
  for (const f of ['AGENTS.md', 'CLAUDE.md', 'OLLY.md', 'CONTRIBUTING.md']) {
    const p = path.join(root, f);
    if (fs.existsSync(p)) {
      try { lines.push(`\n--- ${f} ---\n${fs.readFileSync(p, 'utf8').slice(0, 4000)}`); } catch { /* ignore */ }
      break;
    }
  }
  return lines.join('\n');
}

export class Agent {
  /**
   * @param {object} o
   * @param {import('../router/router.js').OmniRouter} o.router
   * @param {string} o.root                       workspace root
   * @param {object} [o.config]
   * @param {(req:{tool:string,args:object,danger:string})=>Promise<boolean>} [o.approve]
   * @param {object} [o.events]                   UI callbacks
   */
  constructor({ router, root, config = {}, approve, events = {} }) {
    this.router = router;
    this.root = root;
    this.config = config;
    this.approve = approve || (async () => true);
    this.events = events;
    this.messages = [
      { role: 'system', content: SYSTEM },
      { role: 'system', content: workspaceContext(root) },
    ];
    this.changed = new Set();
    this.usage = { prompt: 0, completion: 0, calls: 0 };
  }

  /** Drop the middle of the transcript when it outgrows the context budget. */
  compact(limit = 120_000) {
    while (estimateTokens(this.messages) > limit && this.messages.length > 6) {
      // Keep both system messages and the most recent exchanges.
      const cut = this.messages.splice(2, 2);
      this.events.onCompact?.(cut.length);
    }
  }

  /**
   * Run one user turn to completion.
   * @param {string} input
   * @param {{signal?:AbortSignal}} [opts]
   * @returns {Promise<{text:string, steps:number, changed:string[]}>}
   */
  async run(input, { signal } = {}) {
    this.messages.push({ role: 'user', content: input });

    const readonly = this.config.approval === 'readonly';
    const tools = readonly ? safeToolSchemas() : toolSchemas();
    const task = classifyTask(input, { contextTokens: estimateTokens(this.messages) });
    this.events.onTask?.(task);

    const maxSteps = this.config.maxSteps || 40;
    let finalText = '';

    for (let step = 0; step < maxSteps; step += 1) {
      if (signal?.aborted) throw new Error('interrupted');
      this.compact();

      const res = await this.router.complete({
        messages: this.messages,
        tools,
        task: step === 0 ? task : 'code',
        stream: true,
        signal,
        onDelta: (t) => this.events.onDelta?.(t),
        onFailover: (f) => this.events.onFailover?.(f),
      });

      this.usage.calls += 1;
      this.usage.prompt += res.usage?.prompt_tokens || 0;
      this.usage.completion += res.usage?.completion_tokens || 0;
      this.events.onModel?.(res.pick, res.ms);

      const msg = res.message;
      // Push the assistant message back verbatim: some providers (Gemini 3)
      // attach signatures to tool calls that must be echoed on the next turn.
      this.messages.push(msg);

      if (msg.content) finalText = msg.content;

      const calls = msg.tool_calls || [];
      if (!calls.length) break;

      let finished = false;
      for (const call of calls) {
        const name = call.function?.name;
        const tool = TOOL_MAP[name];
        const args = safeJson(call.function?.arguments) || {};

        if (!tool) {
          this.messages.push({ role: 'tool', tool_call_id: call.id, content: `No such tool "${name}".` });
          continue;
        }

        // Approval gate for anything that writes or executes.
        if (tool.danger !== 'safe' && this.config.approval === 'ask') {
          const ok = await this.approve({ tool: name, args, danger: tool.danger });
          if (!ok) {
            this.messages.push({
              role: 'tool', tool_call_id: call.id,
              content: 'The user declined this action. Stop and ask them how to proceed.',
            });
            continue;
          }
        }

        this.events.onToolStart?.(name, args);
        let out;
        try {
          out = await tool.run(args, { root: this.root, changed: this.changed, config: this.config });
        } catch (e) {
          out = `Error: ${e.message}`;
        }
        this.events.onToolEnd?.(name, out);
        this.messages.push({ role: 'tool', tool_call_id: call.id, content: String(out) });

        if (name === 'finish') { finished = true; finalText = String(out); }
      }
      if (finished) break;
    }

    return { text: finalText, steps: this.usage.calls, changed: [...this.changed] };
  }
}

export { SYSTEM };
