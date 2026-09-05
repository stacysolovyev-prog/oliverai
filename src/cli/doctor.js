/**
 * `olly doctor` - prove the whole chain works, or say exactly what is broken.
 *
 * Every check is a real call, not a guess: keys are verified against their
 * provider, a model actually answers, and repository access is tested with the
 * same GitHub endpoints the agent tools use.
 */

import { getKey, describeKeys } from '../core/config.js';
import { OmniRouter } from '../router/router.js';
import { verifyKey } from '../router/chat.js';
import { canAccess, whoami } from '../tools/github.js';
import { PROVIDERS } from '../router/providers.js';
import { green, theme } from './brand.js';
import { c, ms, spinner } from '../util/ui.js';

const PASS = () => green.neon('PASS');
const FAIL = () => theme.error('FAIL');
const WARN = () => theme.warn('WARN');

function line(status, label, detail = '') {
  console.log(`  ${status}  ${c.white(label.padEnd(34))} ${c.gray(detail)}`);
}

/**
 * @param {{repo?: string}} opts
 * @returns {Promise<boolean>} true when nothing is broken
 */
export async function doctor(opts = {}) {
  console.log(`\n${green.mid('OllyAI self-check')}\n`);
  let ok = true;

  // --- 1. credentials ---
  const rows = describeKeys();
  const inference = rows.filter((r) => r.kind === 'inference');
  if (!inference.length) {
    line(FAIL(), 'model API key', 'none found - run: olly key <paste your key>');
    ok = false;
  } else {
    for (const r of inference) {
      const sp = spinner(`checking ${r.provider}...`).start();
      const cred = getKey(r.provider);
      const valid = await verifyKey(r.provider, cred.key).catch(() => null);
      sp.stop();
      const local = PROVIDERS[r.provider]?.local;
      if (valid === true) line(PASS(), `key: ${r.provider}`, `${r.masked} via ${r.source}`);
      else if (local) line(WARN(), `local: ${r.provider}`, 'not running - start it or ignore this');
      else if (valid === null) line(WARN(), `key: ${r.provider}`, 'could not be checked (network?)');
      else { line(FAIL(), `key: ${r.provider}`, 'the provider rejected this key'); ok = false; }
    }
  }

  // --- 2. what the router can actually reach ---
  const router = new OmniRouter();
  const sp2 = spinner('discovering models...').start();
  const discovered = await router.refresh().catch(() => []);
  sp2.stop();
  const pool = router.pool();
  if (!pool.length) {
    line(FAIL(), 'models reachable', 'no model is available with these keys');
    ok = false;
  } else {
    line(PASS(), 'models reachable', `${pool.length} across ${discovered.length} provider(s)`);
    for (const d of discovered) {
      if (d.count || PROVIDERS[d.provider]?.local) continue;
      line(WARN(), `  ${d.provider}`, 'served no model list; routing will rely on the catalog');
    }
  }

  // --- 3. a real completion ---
  if (pool.length) {
    const sp3 = spinner('asking a model to answer...').start();
    try {
      const out = await router.complete({
        task: 'fast',
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
        maxTokens: 1000,
      });
      sp3.stop();
      const said = String(out.message.content || '').trim().toLowerCase();
      line(said.includes('ok') ? PASS() : WARN(), 'model answers',
        `${out.pick.model.id} (${out.pick.provider}) in ${ms(out.ms)}`);
      if (out.errors?.length) {
        line(WARN(), '  failed over', `${out.errors.length} model(s) before succeeding`);
      }
    } catch (e) {
      sp3.stop();
      line(FAIL(), 'model answers', e.message.split('\n')[0]);
      ok = false;
    }
  }

  // --- 4. tool calling, which the agent loop depends on ---
  if (pool.length) {
    const sp4 = spinner('checking tool calling...').start();
    try {
      const out = await router.complete({
        task: 'code',
        messages: [{ role: 'user', content: 'Read the file README.md using your tool.' }],
        tools: [{
          type: 'function',
          function: {
            name: 'read_file',
            description: 'Read a file',
            parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
          },
        }],
        maxTokens: 1000,
      });
      sp4.stop();
      const called = out.message.tool_calls?.length > 0;
      line(called ? PASS() : FAIL(), 'tool calling',
        called ? `${out.pick.model.id} called read_file` : 'the model returned text instead of a tool call');
      if (!called) ok = false;
    } catch (e) {
      sp4.stop();
      line(FAIL(), 'tool calling', e.message.split('\n')[0]);
      ok = false;
    }
  }

  // --- 5. GitHub ---
  const gh = getKey('github');
  if (!gh) {
    line(WARN(), 'github token', 'none - public repos are readable, but nothing can be committed');
  } else {
    const sp5 = spinner('checking GitHub token...').start();
    try {
      const me = await whoami(gh.key);
      sp5.stop();
      line(PASS(), 'github token', `authenticated as ${me.login}`);
    } catch (e) {
      sp5.stop();
      line(FAIL(), 'github token', e.message);
      ok = false;
    }
  }

  // --- 6. a specific repository ---
  if (opts.repo) {
    const sp6 = spinner(`checking ${opts.repo}...`).start();
    const access = await canAccess(gh?.key || null, opts.repo);
    sp6.stop();
    if (!access.ok) {
      line(FAIL(), `repo: ${opts.repo}`, access.error);
      ok = false;
    } else {
      line(PASS(), `repo: ${opts.repo}`,
        `${access.private ? 'private' : 'public'}, default branch ${access.defaultBranch}`);
      if (access.canPush) line(PASS(), '  write access', 'OllyAI can commit and open pull requests');
      else line(WARN(), '  write access', 'read-only: the token lacks Contents: write on this repo');
    }
  }

  console.log(`\n  ${ok ? green.neon('Everything checks out.') : theme.error('Something above needs fixing.')}\n`);
  return ok;
}
