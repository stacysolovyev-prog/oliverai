/**
 * The interactive session: banner, prompt, slash commands, approval prompts
 * and streaming output.
 */

import readline from 'node:readline';
import path from 'node:path';
import { OmniRouter, resetHealth, classifyTask } from '../router/router.js';
import { Agent } from '../core/agent.js';
import { verifyKey } from '../router/chat.js';
import {
  loadConfig, saveConfig, ingestKeys, describeKeys, removeKey, clearAllKeys, getKey,
} from '../core/config.js';
import { PROVIDERS } from '../router/providers.js';
import { banner, prompt as brandPrompt, theme, green, toolMark, greenBox, MARK } from './brand.js';
import { c, ms, spinner, renderMarkdown, truncate } from '../util/ui.js';
import { relPath } from '../util/paths.js';

const HELP = [
  ['/key <paste>', 'Add an API key. Any format: bare, KEY=value, JSON, curl, .env dump.'],
  ['/keys', 'List the providers you have keys for.'],
  ['/keys rm <provider>', 'Remove one stored key. /keys clear removes all.'],
  ['/model', 'Show the current model. /model <id> pins one. /model auto re-enables routing.'],
  ['/models', 'List every model OmniRoute can reach right now.'],
  ['/route [task]', 'Show the routing table and why each model ranks where it does.'],
  ['/refresh', 'Re-discover which models each provider is serving.'],
  ['/mode <ask|auto|readonly>', 'How much OllyAI may do without confirming.'],
  ['/cd <path>', 'Change the workspace directory.'],
  ['/clone <owner/repo>', 'Clone a GitHub repo into the workspace and switch to it.'],
  ['/diff', 'Show uncommitted changes in the workspace.'],
  ['/clear', 'Start a fresh conversation, keeping your settings.'],
  ['/cost', 'Token usage and which models served this session.'],
  ['/help', 'This list.'],
  ['/exit', 'Quit.'],
];

export async function startRepl({ cwd = process.cwd(), initialPrompt = null } = {}) {
  const config = loadConfig();
  const router = new OmniRouter();
  let root = path.resolve(cwd);

  // Discover live models in the background so the banner is not held up.
  const discovery = router.refresh().catch(() => []);

  const pick = router.pick({ task: 'code' });
  const providers = router.availableProviders();
  console.log(banner({
    brain: pick ? `${pick.model.name} ${c.gray(`(${pick.provider})`)}` : c.yellow('no key yet - run /key <paste your key>'),
    models: router.pool().length,
    providers: providers.length,
    cwd: relPath(root, path.dirname(root)),
    approval: config.approval,
  }));

  if (!providers.length) {
    console.log(theme.warn('  No API key found. Paste one with  /key <your key>'));
    console.log(c.gray('  A free Google AI Studio key works well: https://aistudio.google.com/apikey\n'));
  }

  let agent = newAgent();
  function newAgent() {
    return new Agent({
      router, root, config,
      approve: askApproval,
      events: {
        onToolStart(name, args) {
          const detail = args.path || args.command || args.args || args.pattern || args.summary || '';
          console.log(`${toolMark(name)} ${c.gray(truncate(String(detail).replace(/\n/g, ' '), 70))}`);
        },
        onToolEnd(name, out) {
          const first = String(out).split('\n')[0];
          console.log(`  ${green.deep('└')} ${c.gray(truncate(first, 76))}`);
        },
        onFailover({ from, kind }) {
          console.log(theme.warn(`  ~ ${from} unavailable (${kind}), routing to the next model`));
        },
        onModel(p, took) { lastModel = { p, took }; },
      },
    });
  }

  const rl = readline.createInterface({
    input: process.stdin, output: process.stdout, prompt: brandPrompt(), historySize: 500,
  });

  let lastModel = null;
  let busy = false;
  let controller = null;

  async function askApproval({ tool, args, danger }) {
    const what = args.command || args.args || args.path || JSON.stringify(args).slice(0, 120);
    console.log(greenBox([
      `${c.bold(danger === 'exec' ? 'Run command' : 'Edit file')}  ${c.white(truncate(String(what), 60))}`,
      c.gray(`tool: ${tool}`),
    ]));
    const answer = await question(`  ${green.neon('allow?')} ${c.gray('[y]es / [n]o / [a]lways')} `);
    const a = answer.trim().toLowerCase();
    if (a === 'a' || a === 'always') {
      config.approval = 'auto';
      saveConfig({ approval: 'auto' });
      console.log(c.gray('  Approval mode set to auto for this and future sessions.\n'));
      return true;
    }
    return a === '' || a === 'y' || a === 'yes';
  }

  function question(q) {
    return new Promise((resolve) => {
      rl.question(q, (ans) => resolve(ans));
    });
  }

  async function handleSlash(line) {
    const [cmd, ...rest] = line.trim().split(/\s+/);
    const arg = rest.join(' ');

    switch (cmd) {
      case '/help':
        console.log('');
        for (const [k, v] of HELP) console.log(`  ${green.neon(k.padEnd(26))} ${c.gray(v)}`);
        console.log('');
        return true;

      case '/key': {
        if (!arg) { console.log(c.gray('  Usage: /key <paste anything containing a key>\n')); return true; }
        const sp = spinner('checking key with the provider...').start();
        const results = await ingestKeys(arg, { verify: verifyKey });
        sp.stop();
        if (!results.length) {
          console.log(theme.error('  No API key found in that text.\n'));
          return true;
        }
        for (const r of results) {
          if (r.stored) {
            const mark = r.verified === true ? green.neon('verified') : c.gray('unverified');
            console.log(`  ${green.neon('+')} ${c.bold(r.provider)} ${c.gray(`(${r.label})`)} ${mark}`);
          } else {
            console.log(`  ${theme.warn('-')} ${r.provider || 'unknown'} ${c.gray(r.reason)}`);
          }
        }
        await router.refresh().catch(() => {});
        const p2 = router.pick({ task: 'code' });
        if (p2) console.log(c.gray(`  brain is now ${p2.model.name} (${p2.provider})\n`));
        else console.log('');
        return true;
      }

      case '/keys': {
        const sub = rest[0];
        if (sub === 'clear') { clearAllKeys(); console.log(c.gray('  All stored keys removed.\n')); return true; }
        if (sub === 'rm' && rest[1]) {
          console.log(c.gray(removeKey(rest[1]) ? `  Removed ${rest[1]}.\n` : `  No stored key for ${rest[1]}.\n`));
          return true;
        }
        const rows = describeKeys();
        if (!rows.length) { console.log(c.gray('  No keys yet. Add one with /key <paste>\n')); return true; }
        console.log('');
        for (const r of rows) {
          const v = r.verified === true ? green.neon(' verified') : '';
          console.log(`  ${green.mid(r.provider.padEnd(16))} ${c.white(r.masked.padEnd(24))} ${c.gray(r.source)}${v}`);
        }
        console.log('');
        return true;
      }

      case '/model': {
        if (!arg) {
          const p3 = router.pick({ task: 'code' });
          console.log(c.gray(`  mode: ${config.model === 'auto' ? 'auto (OmniRoute picks per turn)' : `pinned to ${config.model}`}`));
          if (p3) console.log(c.gray(`  next turn would use: ${p3.model.id} (${p3.provider})\n`));
          return true;
        }
        if (arg === 'auto') {
          saveConfig({ model: 'auto' }); config.model = 'auto'; router.pinned = null;
          console.log(c.gray('  Routing re-enabled.\n'));
          return true;
        }
        saveConfig({ model: arg }); config.model = arg; router.pinned = arg;
        console.log(c.gray(`  Pinned to ${arg}.\n`));
        return true;
      }

      case '/models': {
        await discovery;
        const pool = router.pool();
        console.log(c.gray(`\n  ${pool.length} models reachable with your keys:\n`));
        for (const m of pool.slice(0, 60)) {
          console.log(`  ${green.mid(m.provider.padEnd(15))} ${c.white(m.id.padEnd(42))} ${c.gray(`${m.free ? 'free ' : '     '}${m.tools ? 'tools' : '     '} ${(m.ctx / 1000).toFixed(0)}k`)}`);
        }
        console.log('');
        return true;
      }

      case '/route': {
        const task = rest[0] || 'code';
        console.log(c.gray(`\n  OmniRoute ranking for "${task}":\n`));
        for (const r of router.explain(task, 10)) {
          console.log(`  ${green.neon(String(r.rank).padStart(2))}. ${c.white(r.model.padEnd(40))} ${c.gray(`${r.provider}  score ${r.score}`)}`);
          console.log(`      ${c.gray(r.why.join(' · '))}`);
        }
        console.log('');
        return true;
      }

      case '/refresh': {
        const sp = spinner('asking each provider what it serves...').start();
        const out = await router.refresh();
        sp.stop();
        for (const r of out) console.log(c.gray(`  ${r.provider}: ${r.count} models`));
        console.log('');
        return true;
      }

      case '/mode': {
        if (!['ask', 'auto', 'readonly'].includes(arg)) {
          console.log(c.gray(`  Usage: /mode ask|auto|readonly  (currently ${config.approval})\n`));
          return true;
        }
        config.approval = arg; saveConfig({ approval: arg });
        console.log(c.gray(`  Approval mode: ${arg}\n`));
        return true;
      }

      case '/cd': {
        const target = path.resolve(root, arg || '.');
        try { process.chdir(target); } catch (e) { console.log(theme.error(`  ${e.message}\n`)); return true; }
        root = target; agent = newAgent();
        console.log(c.gray(`  workspace: ${root}\n`));
        return true;
      }

      case '/clone': {
        if (!arg) { console.log(c.gray('  Usage: /clone owner/repo\n')); return true; }
        const gh = getKey('github');
        const slug = arg.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
        const url = gh
          ? `https://x-access-token:${gh.key}@github.com/${slug}.git`
          : `https://github.com/${slug}.git`;
        const dest = path.join(root, slug.split('/')[1]);
        const sp = spinner(`cloning ${slug}...`).start();
        const { execFile } = await import('node:child_process');
        const { promisify } = await import('node:util');
        try {
          await promisify(execFile)('git', ['clone', '--depth', '50', url, dest], {
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, timeout: 180000,
          });
          sp.stop(`  ${green.neon('+')} cloned to ${relPath(dest)}`);
          process.chdir(dest); root = dest; agent = newAgent();
          console.log(c.gray(`  workspace: ${root}\n`));
        } catch (e) {
          sp.stop(theme.error(`  clone failed: ${String(e.stderr || e.message).split('\n')[0]}`));
          if (!gh) console.log(c.gray('  If the repo is private, add a GitHub token first: /key <your PAT>\n'));
        }
        return true;
      }

      case '/diff': {
        const { execFile } = await import('node:child_process');
        const { promisify } = await import('node:util');
        try {
          const { stdout } = await promisify(execFile)('git', ['diff', '--stat', 'HEAD'], { cwd: root });
          console.log(stdout ? `\n${stdout}` : c.gray('  No uncommitted changes.\n'));
        } catch { console.log(c.gray('  Not a git repository.\n')); }
        return true;
      }

      case '/clear':
        agent = newAgent();
        console.log(c.gray('  Conversation cleared.\n'));
        return true;

      case '/cost': {
        const u = agent.usage;
        console.log(greenBox([
          `${green.deep('tokens'.padEnd(10))}${c.white(`${u.prompt.toLocaleString()} in / ${u.completion.toLocaleString()} out`)}`,
          `${green.deep('calls'.padEnd(10))}${c.white(String(u.calls))}`,
          `${green.deep('failover'.padEnd(10))}${c.white(String(router.stats.failovers))}`,
          `${green.deep('models'.padEnd(10))}${c.white(Object.entries(router.stats.byModel).map(([k, v]) => `${k} x${v}`).join(', ') || 'none yet')}`,
          `${green.deep('cost'.padEnd(10))}${green.neon('$0.00 on free tiers')}`,
        ], { title: 'session' }));
        console.log('');
        return true;
      }

      case '/health':
        resetHealth();
        console.log(c.gray('  Model health reset; cooldowns cleared.\n'));
        return true;

      case '/exit': case '/quit':
        rl.close();
        return true;

      default:
        console.log(c.gray(`  Unknown command ${cmd}. Try /help\n`));
        return true;
    }
  }

  async function handleTurn(line) {
    busy = true;
    controller = new AbortController();
    const started = Date.now();
    const sp = spinner('thinking...').start();
    let firstToken = true;

    agent.events.onDelta = (t) => {
      if (firstToken) { sp.stop(); firstToken = false; process.stdout.write('\n'); }
      process.stdout.write(t);
    };

    try {
      const res = await agent.run(line, { signal: controller.signal });
      sp.stop();
      if (firstToken && res.text) console.log(`\n${renderMarkdown(res.text)}`);
      else process.stdout.write('\n');

      const bits = [];
      if (lastModel?.p) bits.push(`${lastModel.p.model.id}`);
      bits.push(ms(Date.now() - started));
      if (res.changed.length) bits.push(`${res.changed.length} file${res.changed.length === 1 ? '' : 's'} changed`);
      console.log(c.gray(`\n  ${bits.join('  ·  ')}\n`));
    } catch (e) {
      sp.stop();
      if (String(e.message).includes('interrupted')) console.log(c.gray('\n  interrupted\n'));
      else console.log(`\n${theme.error(`  ${e.message}`)}\n`);
    } finally {
      busy = false; controller = null;
    }
  }

  rl.on('SIGINT', () => {
    if (busy && controller) { controller.abort(new Error('interrupted')); return; }
    console.log(c.gray('\n  bye'));
    rl.close();
  });

  rl.on('line', async (line) => {
    const text = line.trim();
    if (!text) { rl.prompt(); return; }
    try {
      if (text.startsWith('/')) await handleSlash(text);
      else await handleTurn(text);
    } catch (e) {
      console.log(theme.error(`  ${e.message}`));
    }
    if (!rl.closed) rl.prompt();
  });

  rl.on('close', () => process.exit(0));

  if (initialPrompt) { await handleTurn(initialPrompt); }
  rl.prompt();
}

export { HELP, MARK, classifyTask };
