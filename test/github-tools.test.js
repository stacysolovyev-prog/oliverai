import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// Point the tools at a stub before importing them.
const files = { 'README.md': '# Demo\n', 'src/app.js': 'export const x = 1;\n' };
const commits = [];
let branches = { main: 'basesha' };
let prs = [];

const server = http.createServer((req, res) => {
  const [path] = req.url.split('?');
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

  if (path === '/repos/o/r') return send(200, { full_name: 'o/r', default_branch: 'main', private: false, permissions: { push: true } });
  if (path === '/repos/o/r/git/ref/heads/main') return send(200, { object: { sha: 'basesha' } });
  if (path === '/repos/o/r/git/refs' && req.method === 'POST') {
    let body = ''; req.on('data', (d) => { body += d; });
    return req.on('end', () => { branches[JSON.parse(body).ref.split('/').pop()] = 'basesha'; send(201, {}); });
  }
  if (path.startsWith('/repos/o/r/git/trees/')) {
    return send(200, { tree: Object.keys(files).map((p) => ({ path: p, type: 'blob' })) });
  }
  if (path.startsWith('/repos/o/r/contents/')) {
    const p = decodeURIComponent(path.replace('/repos/o/r/contents/', ''));
    if (req.method === 'PUT') {
      let body = ''; req.on('data', (d) => { body += d; });
      return req.on('end', () => {
        const j = JSON.parse(body);
        files[p] = Buffer.from(j.content, 'base64').toString('utf8');
        commits.push({ path: p, message: j.message, branch: j.branch });
        send(200, { content: { sha: `sha-${p}` }, commit: { sha: 'c0ffee1234' } });
      });
    }
    if (files[p] === undefined) return send(404, { message: 'Not Found' });
    return send(200, { path: p, sha: `sha-${p}`, size: files[p].length, content: b64(files[p]) });
  }
  if (path === '/repos/o/r/pulls' && req.method === 'POST') {
    let body = ''; req.on('data', (d) => { body += d; });
    return req.on('end', () => { const j = JSON.parse(body); prs.push(j); send(201, { number: 7, html_url: 'https://github.com/o/r/pull/7' }); });
  }
  return send(404, { message: 'Not Found' });
});

let RepoSession; let githubTools;

before(async () => {
  await new Promise((r) => server.listen(0, r));
  process.env.GITHUB_API_URL = `http://127.0.0.1:${server.address().port}`;
  ({ RepoSession, githubTools } = await import('../src/tools/github.js'));
});
after(() => server.close());

function toolset() {
  const s = new RepoSession({ token: 't', repo: 'o/r' });
  const t = githubTools(s);
  return { session: s, byName: Object.fromEntries(t.map((x) => [x.name, x])) };
}

test('lists files from the repository tree', async () => {
  const { byName } = toolset();
  const out = await byName.gh_list_files.run({});
  assert.match(out, /README\.md/);
  assert.match(out, /src\/app\.js/);
});

test('reads a file with line numbers', async () => {
  const { byName } = toolset();
  const out = await byName.gh_read_file.run({ path: 'src/app.js' });
  assert.match(out, /export const x = 1;/);
  assert.match(out, /1\|/);
});

test('an edit commits to a new working branch, never the default', async () => {
  const { session, byName } = toolset();
  const out = await byName.gh_edit_file.run({
    path: 'src/app.js', old: 'const x = 1', new: 'const x = 2',
  });
  assert.match(out, /Edited src\/app\.js/);
  assert.ok(session.branch.startsWith('ollyai/'), 'a working branch must be created');
  assert.notEqual(session.branch, 'main');
  assert.equal(files['src/app.js'].trim(), 'export const x = 2;');
  assert.equal(commits.at(-1).branch, session.branch, 'the commit must land on the working branch');
});

test('an edit whose anchor is missing changes nothing and explains why', async () => {
  const { byName } = toolset();
  const before = files['README.md'];
  const out = await byName.gh_edit_file.run({ path: 'README.md', old: 'nowhere', new: 'x' });
  assert.match(out, /No match/);
  assert.equal(files['README.md'], before);
});

test('creating a new file works and is tracked as touched', async () => {
  const { session, byName } = toolset();
  await byName.gh_write_file.run({ path: 'NEW.md', content: 'hi\n', message: 'add' });
  assert.equal(files['NEW.md'], 'hi\n');
  assert.ok(session.touched.has('NEW.md'));
});

test('a pull request targets the default branch from the working branch', async () => {
  const { session, byName } = toolset();
  await byName.gh_write_file.run({ path: 'P.md', content: 'p' });
  const out = await byName.gh_open_pr.run({ title: 'Test', body: 'why' });
  assert.match(out, /#7/);
  assert.equal(prs.at(-1).base, 'main');
  assert.equal(prs.at(-1).head, session.branch);
});

test('opening a pull request before any change is refused clearly', async () => {
  const { byName } = toolset();
  const out = await byName.gh_open_pr.run({ title: 'Nothing' });
  assert.match(out, /Nothing has been changed/);
});

test('writing without a token fails fast with actionable guidance', async () => {
  const s = new RepoSession({ token: null, repo: 'o/r' });
  const byName = Object.fromEntries(githubTools(s).map((x) => [x.name, x]));
  await assert.rejects(
    () => byName.gh_write_file.run({ path: 'x.md', content: 'x' }),
    (e) => e.auth === true && /needs a GitHub token/.test(e.message),
  );
});
