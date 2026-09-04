/**
 * Repository tools backed by the GitHub REST API.
 *
 * The CLI edits a checkout on disk. A serverless request has no checkout, so
 * these tools read and write through the API instead, which lets the web app
 * work on a repo directly with the user's own token.
 *
 * Writes never touch the default branch. The first write creates a working
 * branch off it, so everything the agent does arrives as a reviewable diff and
 * can be opened as a pull request.
 */

// Overridable so the tools can target GitHub Enterprise, and so the agent
// loop can be exercised against a stub in tests.
const API = process.env.GITHUB_API_URL || 'https://api.github.com';
const MAX_FILE = 300_000;

function headers(token) {
  const h = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'OllyAI',
    'Content-Type': 'application/json',
  };
  // A public repository can be read with no credential at all, so a missing
  // token limits what you can do rather than blocking you outright.
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function gh(token, path, init = {}, timeoutMs = 25000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(path.startsWith('http') ? path : API + path, {
      ...init, headers: headers(token), signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* some endpoints return no body */ }
    if (!res.ok) {
      const msg = json?.message || text.slice(0, 200) || res.statusText;
      const err = new Error(`GitHub ${res.status}: ${msg}`);
      err.status = res.status;
      // 401/403 will not resolve by trying again; the caller must stop and
      // tell the user, rather than spending the whole time budget on retries.
      err.auth = res.status === 401 || res.status === 403;
      throw err;
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

function splitRepo(repo) {
  const m = String(repo || '').replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '')
    .match(/^([^/\s]+)\/([^/\s]+)$/);
  if (!m) throw new Error(`repo must look like "owner/name", got "${repo}"`);
  return { owner: m[1], name: m[2] };
}

const b64encode = (s) => Buffer.from(s, 'utf8').toString('base64');
const b64decode = (s) => Buffer.from(String(s).replace(/\n/g, ''), 'base64').toString('utf8');

/**
 * Per-request repository session. Holds the token, the repo, and the working
 * branch once one has been created.
 */
export class RepoSession {
  constructor({ token, repo, branch = null, baseBranch = null }) {
    const { owner, name } = splitRepo(repo);
    this.token = token;
    this.owner = owner;
    this.name = name;
    this.slug = `${owner}/${name}`;
    this.branch = branch;          // where writes go
    this.baseBranch = baseBranch;  // what the working branch came from
    this.touched = new Set();
    this.sha = new Map();          // path -> blob sha, needed to update a file
  }

  async repoInfo() {
    if (!this._info) this._info = await gh(this.token, `/repos/${this.slug}`);
    return this._info;
  }

  /** The branch reads come from: the working branch if any, else the default. */
  async readRef() {
    if (this.branch) return this.branch;
    if (!this.baseBranch) this.baseBranch = (await this.repoInfo()).default_branch;
    return this.baseBranch;
  }

  /**
   * Ensure a working branch exists. Called before the first write so the
   * default branch is never committed to directly.
   */
  async ensureBranch() {
    if (this.branch) return this.branch;
    if (!this.token) {
      const e = new Error('Writing needs a GitHub token. Paste one in the key panel (a fine-grained PAT with Contents: read and write).');
      e.auth = true;
      throw e;
    }
    const info = await this.repoInfo();
    this.baseBranch ||= info.default_branch;
    const ref = await gh(this.token, `/repos/${this.slug}/git/ref/heads/${encodeURIComponent(this.baseBranch)}`);
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
    const name = `ollyai/${stamp}`;
    try {
      await gh(this.token, `/repos/${this.slug}/git/refs`, {
        method: 'POST',
        body: JSON.stringify({ ref: `refs/heads/${name}`, sha: ref.object.sha }),
      });
    } catch (e) {
      if (e.status !== 422) throw e; // 422 means it already exists, which is fine
    }
    this.branch = name;
    return name;
  }
}

/** Tool definitions plus their implementations, bound to a RepoSession. */
export function githubTools(session) {
  return [
    {
      name: 'gh_list_files',
      danger: 'safe',
      description: 'List the files in the repository. Start here to see what exists.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Only return files under this directory.' },
          max: { type: 'integer', description: 'Maximum paths to return (default 300).' },
        },
      },
      async run({ path = '', max = 300 }) {
        const ref = await session.readRef();
        const tree = await gh(session.token,
          `/repos/${session.slug}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
        let files = (tree.tree || []).filter((t) => t.type === 'blob').map((t) => t.path);
        if (path) files = files.filter((f) => f.startsWith(path.replace(/^\//, '')));
        const shown = files.slice(0, max);
        return `${files.length} files on ${ref}${files.length > shown.length ? ` (showing ${shown.length})` : ''}\n${shown.join('\n')}`;
      },
    },
    {
      name: 'gh_read_file',
      danger: 'safe',
      description: 'Read one file from the repository. Always read a file before editing it.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
      async run({ path }) {
        const ref = await session.readRef();
        const file = await gh(session.token,
          `/repos/${session.slug}/contents/${encodeURI(path)}?ref=${encodeURIComponent(ref)}`);
        if (Array.isArray(file)) return `${path} is a directory containing: ${file.map((f) => f.name).join(', ')}`;
        if (file.size > MAX_FILE) return `${path} is ${file.size} bytes, too large to read.`;
        session.sha.set(path, file.sha);
        const body = b64decode(file.content || '');
        const lines = body.split('\n');
        return `${path} (${lines.length} lines, sha ${file.sha.slice(0, 7)})\n`
          + lines.map((l, i) => `${String(i + 1).padStart(5)}|${l}`).join('\n');
      },
    },
    {
      name: 'gh_write_file',
      danger: 'write',
      description:
        'Create or replace a file, committing it to a working branch. Provide the '
        + 'complete new contents. The default branch is never written to directly.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string', description: 'The complete new file contents.' },
          message: { type: 'string', description: 'Commit message.' },
        },
        required: ['path', 'content'],
      },
      async run({ path, content, message }) {
        const branch = await session.ensureBranch();
        let sha = session.sha.get(path);
        if (!sha) {
          // Look up the blob sha; absent means we are creating the file.
          try {
            const cur = await gh(session.token,
              `/repos/${session.slug}/contents/${encodeURI(path)}?ref=${encodeURIComponent(branch)}`);
            sha = cur.sha;
          } catch (e) { if (e.status !== 404) throw e; }
        }
        const body = {
          message: message || `OllyAI: update ${path}`,
          content: b64encode(content),
          branch,
        };
        if (sha) body.sha = sha;
        const res = await gh(session.token, `/repos/${session.slug}/contents/${encodeURI(path)}`, {
          method: 'PUT', body: JSON.stringify(body),
        });
        session.sha.set(path, res.content.sha);
        session.touched.add(path);
        return `${sha ? 'Updated' : 'Created'} ${path} on branch ${branch} (${res.commit.sha.slice(0, 7)})`;
      },
    },
    {
      name: 'gh_edit_file',
      danger: 'write',
      description:
        'Replace an exact substring in a file and commit it. `old` must appear '
        + 'exactly once. Prefer this over gh_write_file for edits to existing files.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          old: { type: 'string', description: 'Exact text to find, including indentation.' },
          new: { type: 'string' },
          message: { type: 'string' },
        },
        required: ['path', 'old', 'new'],
      },
      async run({ path, old, new: nw, message }) {
        const ref = await session.readRef();
        const file = await gh(session.token,
          `/repos/${session.slug}/contents/${encodeURI(path)}?ref=${encodeURIComponent(ref)}`);
        const src = b64decode(file.content || '');
        const count = src.split(old).length - 1;
        if (count === 0) return `No match for that text in ${path}. Read the file and copy the exact text.`;
        if (count > 1) return `Found ${count} matches in ${path}. Include more surrounding context to make it unique.`;
        session.sha.set(path, file.sha);
        const out = src.replace(old, nw);
        const branch = await session.ensureBranch();
        // The blob sha differs per branch once the branch has its own commit.
        let sha = file.sha;
        try {
          const onBranch = await gh(session.token,
            `/repos/${session.slug}/contents/${encodeURI(path)}?ref=${encodeURIComponent(branch)}`);
          sha = onBranch.sha;
        } catch (e) { if (e.status !== 404) throw e; }
        const res = await gh(session.token, `/repos/${session.slug}/contents/${encodeURI(path)}`, {
          method: 'PUT',
          body: JSON.stringify({
            message: message || `OllyAI: edit ${path}`,
            content: b64encode(out),
            sha,
            branch,
          }),
        });
        session.sha.set(path, res.content.sha);
        session.touched.add(path);
        return `Edited ${path} on branch ${branch} (${res.commit.sha.slice(0, 7)})`;
      },
    },
    {
      name: 'gh_search_code',
      danger: 'safe',
      description: 'Search this repository for a string or symbol.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
      async run({ query }) {
        const q = encodeURIComponent(`${query} repo:${session.slug}`);
        const res = await gh(session.token, `/search/code?q=${q}&per_page=25`);
        if (!res.total_count) return `No matches for "${query}".`;
        return `${res.total_count} matches:\n${res.items.map((i) => i.path).join('\n')}`;
      },
    },
    {
      name: 'gh_open_pr',
      danger: 'write',
      description: 'Open a pull request from the working branch. Call this once the changes are complete.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          body: { type: 'string', description: 'What changed and why.' },
        },
        required: ['title'],
      },
      async run({ title, body }) {
        if (!session.branch) return 'Nothing has been changed yet, so there is no branch to open a pull request from.';
        const base = session.baseBranch || (await session.repoInfo()).default_branch;
        try {
          const pr = await gh(session.token, `/repos/${session.slug}/pulls`, {
            method: 'POST',
            body: JSON.stringify({
              title,
              head: session.branch,
              base,
              body: `${body || ''}\n\n---\n_Opened by [OllyAI](https://github.com/stacysolovyev-prog/oliverai)_`,
            }),
          });
          return `Opened pull request #${pr.number}: ${pr.html_url}`;
        } catch (e) {
          if (e.status === 422) return `Could not open a pull request (${e.message}). The branch ${session.branch} has the commits either way.`;
          throw e;
        }
      },
    },
    {
      name: 'finish',
      danger: 'safe',
      description: 'Call when the task is complete. Summarise what changed.',
      parameters: {
        type: 'object',
        properties: { summary: { type: 'string' } },
        required: ['summary'],
      },
      async run({ summary }) { return summary || 'done'; },
    },
  ];
}

/** Check a token and report what it can reach. */
export async function whoami(token) {
  const user = await gh(token, '/user');
  return { login: user.login, name: user.name };
}

export async function canAccess(token, repo) {
  try {
    const { owner, name } = splitRepo(repo);
    const r = await gh(token, `/repos/${owner}/${name}`);
    return {
      ok: true,
      slug: r.full_name,
      private: r.private,
      defaultBranch: r.default_branch,
      canPush: Boolean(r.permissions?.push),
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export { gh, splitRepo };
