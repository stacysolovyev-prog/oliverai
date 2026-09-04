/**
 * The tool surface the agent drives: filesystem, search, shell and git.
 *
 * Every tool declares an OpenAI-format JSON schema, a `danger` level used by
 * the approval gate, and a `run` implementation. Results are returned as
 * strings because that is what goes back into the transcript.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const pexec = promisify(execFile);

const MAX_READ = 400_000;      // bytes we will pull into context from one file
const MAX_OUT = 30_000;        // cap on any single tool result
const NUL = String.fromCharCode(0);

function clip(s, n = MAX_OUT) {
  s = String(s ?? '');
  return s.length <= n ? s : `${s.slice(0, n)}\n... [truncated ${s.length - n} more chars]`;
}

/** Resolve a path and refuse to escape the workspace root. */
function resolveIn(root, p) {
  const abs = path.resolve(root, p || '.');
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`path "${p}" is outside the workspace (${root})`);
  }
  return abs;
}

const IGNORED = /(^|\/)(node_modules|\.git|dist|build|\.next|__pycache__|\.venv|venv|target|vendor|\.cache)(\/|$)/;

function walk(dir, root, out = [], depth = 0) {
  if (depth > 12 || out.length > 5000) return out;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    const rel = path.relative(root, abs);
    if (IGNORED.test(rel)) continue;
    if (e.name.startsWith('.') && e.name !== '.github') continue;
    if (e.isDirectory()) walk(abs, root, out, depth + 1);
    else out.push(rel);
  }
  return out;
}

export const TOOLS = [
  {
    name: 'read_file',
    danger: 'safe',
    description: 'Read a file from the workspace. Returns the contents with line numbers.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the workspace root.' },
        start: { type: 'integer', description: 'First line to return (1-based).' },
        limit: { type: 'integer', description: 'How many lines to return.' },
      },
      required: ['path'],
    },
    async run({ path: p, start, limit }, ctx) {
      const abs = resolveIn(ctx.root, p);
      const stat = fs.statSync(abs);
      if (stat.size > MAX_READ) return `File is ${stat.size} bytes, too large to read whole. Use start/limit or grep.`;
      const lines = fs.readFileSync(abs, 'utf8').split('\n');
      const from = Math.max(1, start || 1);
      const to = Math.min(lines.length, from - 1 + (limit || lines.length));
      const body = lines.slice(from - 1, to)
        .map((l, i) => `${String(from + i).padStart(5)}|${l}`).join('\n');
      return clip(`${p} (${lines.length} lines)\n${body}`);
    },
  },
  {
    name: 'write_file',
    danger: 'write',
    description: 'Create a file or overwrite it completely. Parent directories are created as needed.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string', description: 'The complete new contents of the file.' },
      },
      required: ['path', 'content'],
    },
    async run({ path: p, content }, ctx) {
      const abs = resolveIn(ctx.root, p);
      const existed = fs.existsSync(abs);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
      ctx.changed?.add(p);
      const n = String(content).split('\n').length;
      return `${existed ? 'Overwrote' : 'Created'} ${p} (${n} lines)`;
    },
  },
  {
    name: 'edit_file',
    danger: 'write',
    description:
      'Replace an exact substring in a file. `old` must appear exactly once unless `all` is true. ' +
      'Prefer this over write_file for changes to existing files.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old: { type: 'string', description: 'Exact text to find, including indentation.' },
        new: { type: 'string', description: 'Replacement text.' },
        all: { type: 'boolean', description: 'Replace every occurrence.' },
      },
      required: ['path', 'old', 'new'],
    },
    async run({ path: p, old, new: nw, all }, ctx) {
      const abs = resolveIn(ctx.root, p);
      const src = fs.readFileSync(abs, 'utf8');
      const count = src.split(old).length - 1;
      if (count === 0) return `No match for that text in ${p}. Read the file and copy the exact text, including whitespace.`;
      if (count > 1 && !all) return `Found ${count} matches in ${p}. Pass all=true, or include more surrounding context to make it unique.`;
      const out = all ? src.split(old).join(nw) : src.replace(old, nw);
      fs.writeFileSync(abs, out);
      ctx.changed?.add(p);
      return `Edited ${p} (${count} replacement${count === 1 ? '' : 's'})`;
    },
  },
  {
    name: 'list_dir',
    danger: 'safe',
    description: 'List files under a directory, recursively, skipping node_modules/.git and similar.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Defaults to the workspace root.' } },
    },
    async run({ path: p }, ctx) {
      const abs = resolveIn(ctx.root, p || '.');
      const files = walk(abs, ctx.root);
      return clip(`${files.length} files\n${files.slice(0, 800).join('\n')}`);
    },
  },
  {
    name: 'grep',
    danger: 'safe',
    description: 'Search file contents with a regular expression. Returns matching lines with their paths.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        glob: { type: 'string', description: 'Optional filename filter, e.g. "*.ts".' },
        max: { type: 'integer', description: 'Maximum matches to return (default 80).' },
      },
      required: ['pattern'],
    },
    async run({ pattern, glob, max = 80 }, ctx) {
      let re;
      try { re = new RegExp(pattern, 'i'); } catch (e) { return `Invalid regex: ${e.message}`; }
      const nameRe = glob
        ? new RegExp('^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$')
        : null;
      const hits = [];
      for (const rel of walk(ctx.root, ctx.root)) {
        if (nameRe && !nameRe.test(path.basename(rel))) continue;
        if (hits.length >= max) break;
        let text;
        try {
          if (fs.statSync(path.join(ctx.root, rel)).size > MAX_READ) continue;
          text = fs.readFileSync(path.join(ctx.root, rel), 'utf8');
        } catch { continue; }
        if (text.includes(NUL)) continue; // binary
        const lines = text.split('\n');
        for (let i = 0; i < lines.length && hits.length < max; i += 1) {
          if (re.test(lines[i])) hits.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
        }
      }
      return hits.length ? clip(hits.join('\n')) : `No matches for /${pattern}/`;
    },
  },
  {
    name: 'bash',
    danger: 'exec',
    description:
      'Run a shell command in the workspace. Use for builds, tests, installs and git. ' +
      'Non-interactive only; there is no TTY.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        timeout: { type: 'integer', description: 'Seconds before the command is killed (default 120).' },
      },
      required: ['command'],
    },
    async run({ command, timeout = 120 }, ctx) {
      try {
        const { stdout, stderr } = await pexec('bash', ['-lc', command], {
          cwd: ctx.root,
          timeout: timeout * 1000,
          maxBuffer: 10 * 1024 * 1024,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        });
        const out = [stdout, stderr].filter(Boolean).join('\n').trim();
        return clip(out || '(no output)');
      } catch (e) {
        const out = [e.stdout, e.stderr, e.message].filter(Boolean).join('\n').trim();
        return clip(`exit ${e.code ?? '?'}\n${out}`);
      }
    },
  },
  {
    name: 'git',
    danger: 'exec',
    description: 'Run a git subcommand in the workspace, e.g. "status --short" or "commit -m msg".',
    parameters: {
      type: 'object',
      properties: { args: { type: 'string', description: 'Everything after the word `git`.' } },
      required: ['args'],
    },
    async run({ args }, ctx) {
      try {
        const { stdout, stderr } = await pexec('bash', ['-lc', `git ${args}`], {
          cwd: ctx.root, timeout: 120000, maxBuffer: 10 * 1024 * 1024,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        });
        return clip([stdout, stderr].filter(Boolean).join('\n').trim() || '(no output)');
      } catch (e) {
        return clip(`exit ${e.code ?? '?'}\n${[e.stdout, e.stderr, e.message].filter(Boolean).join('\n')}`);
      }
    },
  },
  {
    name: 'finish',
    danger: 'safe',
    description: 'Call when the task is complete. Summarise what changed in `summary`.',
    parameters: {
      type: 'object',
      properties: { summary: { type: 'string' } },
      required: ['summary'],
    },
    async run({ summary }) { return summary || 'done'; },
  },
];

export const TOOL_MAP = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

/** Tool definitions in the OpenAI wire format. */
export function toolSchemas() {
  return TOOLS.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/** Read-only subset, used when approval mode is `readonly`. */
export function safeToolSchemas() {
  return toolSchemas().filter((t) => TOOL_MAP[t.function.name].danger === 'safe');
}
