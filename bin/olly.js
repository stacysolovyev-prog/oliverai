#!/usr/bin/env node
/**
 * OllyAI CLI entry point.
 *
 *   olly                      start an interactive session
 *   olly "fix the login bug"  run one task and exit
 *   olly key <paste>          add an API key in any format
 *   olly keys                 list configured providers
 *   olly models               list reachable models
 *   olly route [task]         show the routing table
 */

import path from 'node:path';
import { startRepl } from '../src/cli/repl.js';
import { OmniRouter } from '../src/router/router.js';
import { Agent } from '../src/core/agent.js';
import { verifyKey } from '../src/router/chat.js';
import { loadConfig, saveConfig, ingestKeys, describeKeys } from '../src/core/config.js';
import { logoBig, green, theme, toolMark } from '../src/cli/brand.js';
import { c, renderMarkdown, truncate } from '../src/util/ui.js';

const VERSION = '0.1.0';

const USAGE = `
${green.neon('OllyAI')} ${c.gray(`v${VERSION}`)} - a coding agent that runs on free models

${green.mid('Usage')}
  olly                          Start an interactive session
  olly "<task>"                 Run one task in the current directory, then exit
  olly key <paste>              Add an API key (any format: bare, KEY=value, JSON, curl, .env)
  olly keys                     Show which providers are configured
  olly models                   List every model reachable with your keys
  olly route [plan|code|fast]   Show how OmniRoute ranks models for a task
  olly refresh                  Re-discover models from each provider

${green.mid('Options')}
  -C, --cwd <dir>               Work in this directory
  -p, --print                   Print the result and exit (no interactive session)
  -y, --yes                     Approve file writes and commands automatically
  --readonly                    Never write or execute; investigate only
  --model <id>                  Pin one model instead of routing
  -h, --help                    This message
  -v, --version                 Version

${green.mid('Getting started')}
  ${c.gray('# a free Google AI Studio key is the quickest start')}
  olly key AQ.your_key_here
  olly "add a health check endpoint and a test for it"
`;

function parseArgs(argv) {
  const opts = { cwd: process.cwd(), print: false, yes: false, readonly: false, model: null, _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '-C' || a === '--cwd') opts.cwd = argv[++i];
    else if (a === '-p' || a === '--print') opts.print = true;
    else if (a === '-y' || a === '--yes') opts.yes = true;
    else if (a === '--readonly') opts.readonly = true;
    else if (a === '--model') opts.model = argv[++i];
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '-v' || a === '--version') opts.version = true;
    else opts._.push(a);
  }
  return opts;
}

async function runOnce(task, opts) {
  const config = loadConfig();
  if (opts.yes) config.approval = 'auto';
  if (opts.readonly) config.approval = 'readonly';
  if (opts.model) config.model = opts.model;

  const router = new OmniRouter(config);
  await router.refresh().catch(() => {});

  const agent = new Agent({
    router,
    root: path.resolve(opts.cwd),
    config,
    approve: async () => config.approval !== 'readonly',
    events: {
      onToolStart(name, args) {
        const d = args.path || args.command || args.args || args.pattern || '';
        process.stderr.write(`${toolMark(name)} ${c.gray(truncate(String(d).replace(/\n/g, ' '), 70))}\n`);
      },
      onFailover({ from, kind }) {
        process.stderr.write(theme.warn(`  ~ ${from} (${kind}) - routing onward\n`));
      },
    },
  });

  const res = await agent.run(task);
  console.log(renderMarkdown(res.text || '(no output)'));
  if (res.changed.length) {
    process.stderr.write(c.gray(`\n${res.changed.length} file(s) changed: ${res.changed.join(', ')}\n`));
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.version) { console.log(VERSION); return; }
  if (opts.help) { console.log(USAGE); return; }

  const [sub, ...rest] = opts._;

  switch (sub) {
    case 'key': {
      const blob = rest.join(' ');
      if (!blob) { console.error('Usage: olly key <paste your key>'); process.exit(1); }
      const results = await ingestKeys(blob, { verify: verifyKey });
      if (!results.length) { console.error(theme.error('No API key found in that text.')); process.exit(1); }
      for (const r of results) {
        console.log(r.stored
          ? `${green.neon('+')} ${r.provider} ${c.gray(`(${r.label})`)}${r.verified === true ? green.neon(' verified') : ''}`
          : `${theme.warn('-')} ${r.provider || 'unknown'} ${c.gray(r.reason)}`);
      }
      return;
    }
    case 'keys': {
      const rows = describeKeys();
      if (!rows.length) { console.log(c.gray('No keys yet. Add one:  olly key <paste>')); return; }
      for (const r of rows) {
        console.log(`${green.mid(r.provider.padEnd(16))} ${r.masked.padEnd(24)} ${c.gray(r.source)}`);
      }
      return;
    }
    case 'models': {
      const router = new OmniRouter();
      await router.refresh().catch(() => {});
      for (const m of router.pool()) {
        console.log(`${green.mid(m.provider.padEnd(15))} ${m.id.padEnd(44)} ${c.gray(`${m.free ? 'free' : 'paid'} ${(m.ctx / 1000).toFixed(0)}k`)}`);
      }
      return;
    }
    case 'route': {
      const router = new OmniRouter();
      await router.refresh().catch(() => {});
      for (const r of router.explain(rest[0] || 'code', 12)) {
        console.log(`${green.neon(String(r.rank).padStart(2))}. ${r.model.padEnd(42)} ${c.gray(`${r.provider}  ${r.score}`)}`);
        console.log(`    ${c.gray(r.why.join(' · '))}`);
      }
      return;
    }
    case 'refresh': {
      const router = new OmniRouter();
      for (const r of await router.refresh()) console.log(`${r.provider}: ${r.count} models`);
      return;
    }
    case 'logo':
      console.log(`\n${logoBig()}\n`);
      return;
    default: break;
  }

  const task = opts._.join(' ').trim();

  if (opts.model) saveConfig({ model: opts.model });
  if (opts.readonly) saveConfig({ approval: 'readonly' });
  else if (opts.yes) saveConfig({ approval: 'auto' });

  if (task && opts.print) { await runOnce(task, opts); return; }
  await startRepl({ cwd: opts.cwd, initialPrompt: task || null });
}

main().catch((e) => {
  console.error(theme.error(`\nollyai: ${e.message}\n`));
  process.exit(1);
});
