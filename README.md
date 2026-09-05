<div align="center">

```
  ██████╗ ██╗     ██╗  ██╗   ██╗ █████╗ ██╗
 ██╔═══██╗██║     ██║  ╚██╗ ██╔╝██╔══██╗██║
 ██║   ██║██║     ██║   ╚████╔╝ ███████║██║
 ██║   ██║██║     ██║    ╚██╔╝  ██╔══██║██║
 ╚██████╔╝███████╗███████╗██║   ██║  ██║██║
  ╚═════╝ ╚══════╝╚══════╝╚═╝   ╚═╝  ╚═╝╚═╝
```

**A terminal coding agent that runs on free models.**

</div>

OllyAI reads, writes and runs code in your repo from the terminal. It has no
model of its own — you give it whatever API keys you have and **OmniRoute**
picks the best model you can actually reach for each turn, then fails over the
moment one rate-limits.

## Install

```bash
git clone https://github.com/stacysolovyev-prog/oliverai
cd oliverai && npm link      # gives you `olly`
```

No dependencies. Node 20+.

## Add a key — in any format

The one thing OllyAI refuses to be fussy about. All of these work:

```bash
olly key AQ.Ab8RN6IkVs4...                              # bare token
olly key 'NVIDIA_API_KEY=nvapi-abc123...'               # env line
olly key 'export GROQ_API_KEY="gsk_..."'                # shell export
olly key '{"openrouter_api_key": "sk-or-v1-..."}'       # JSON
olly key 'curl -H "Authorization: Bearer hf_..." ...'   # a curl command
olly key "$(cat .env)"                                  # a whole .env dump
```

It works out the provider from the token's shape, the variable name around it,
or — failing both — by making a live authenticated call. Keys are stored in
`~/.ollyai/keys.json` with `0600` permissions and never written into your project.

The quickest free start is a [Google AI Studio key](https://aistudio.google.com/apikey).

## Use it

```bash
olly                                    # interactive session
olly "add a /health endpoint and a test"
olly -p -y "fix the failing tests"      # one-shot, auto-approve
```

Inside a session:

| command | |
|---|---|
| `/key <paste>` | add a key in any format |
| `/model` | show routing; `/model <id>` pins one |
| `/route [plan\|code\|fast]` | the ranking table, and why |
| `/models` | every model your keys can reach |
| `/clone owner/repo` | clone a GitHub repo and work in it |
| `/mode ask\|auto\|readonly` | how much it may do unattended |
| `/cost` | tokens, failovers, models used |

## Is it working?

```bash
olly doctor                          # keys, models, tool calling
olly doctor HIveAppDeveloper/Hive-app  # ...and access to one repo
```

Every line is a real call, not a guess:

```
  PASS  key: google              AQ.Ab8R******LmGA via stored
  PASS  models reachable         33 across 2 provider(s)
  PASS  model answers            gemini-3.1-flash-lite (google) in 1.4s
  PASS  tool calling             gemini-3.8-flash called read_file
  PASS  repo: owner/name         private, default branch main
  PASS    write access           OllyAI can commit and open pull requests
```

It exits non-zero if anything is broken, so it works in CI too.

## OmniRoute

Routing is the point. Every turn is classified (`plan`, `code`, `fast`, `long`)
and each reachable model is scored on curated quality and speed, weighted for
that task class, with a bonus for free tiers and a penalty for anything that
has been failing you lately.

```
$ olly route code
 1. gemini-3.8-flash        google  15.85
    quality 9.4 x0.8, speed 9.3 x0.45 · tagged "code" · free tier
 2. qwen-3-coder-480b       cerebras 15.6
    quality 9.1 x0.8, speed 9.8 x0.45 · tagged "code" · free tier
```

When a model rate-limits or falls over mid-task, the turn does not fail — it
moves to the next candidate and carries on:

```
⏺ edit_file calc.js
  ~ google:gemini-3.8-flash (server) - routing onward
  ~ google:gemini-3.1-pro-preview (rate) - routing onward
⏺ bash node --check calc.js
```

Latency and error rates are recorded per model in `~/.ollyai/health.json`, so
the routing gets better the more you use it. A provider that rejects your key
is dropped for the rest of the turn rather than retried model by model.

## Providers

Free tiers: **Google AI Studio**, **NVIDIA NIM**, **Groq**, **Cerebras**,
**OpenRouter** (`:free` models), **GitHub Models**, **Mistral**, **Together**,
**Hugging Face**, **Ollama** (local, no key).

Also supported if you have keys: DeepSeek, OpenAI, Anthropic, xAI, Fireworks,
Perplexity.

## Safety

- Keys are stored `0600`, never committed, and masked whenever displayed.
- Tools cannot read or write outside the workspace root.
- `ask` mode (the default) confirms every file write and shell command.
  `readonly` removes those tools entirely.

## Web app (Vercel)

### What key does the deployment need?

**None.** There is nothing to configure — deploy it and it works. Visitors paste
their own key into the sidebar and it stays in their browser.

If you want *your* deployment to work without anyone pasting anything, set one
environment variable in Vercel:

| Name | Value |
|---|---|
| `GEMINI_API_KEY` | a free key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |

Any provider works — `NVIDIA_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`,
`CEREBRAS_API_KEY`, and so on. Set one and the site shows *"Ready — no key
needed"*. A visitor's own key always takes priority over yours.

> Setting a host key means anyone who opens your URL spends **your** free-tier
> quota. Leave it unset for a public link; set it for a private one.

### Deploy

```bash
npm i -g vercel
vercel --prod
```

Or import the repo at [vercel.com/new](https://vercel.com/new). No build step,
no framework, no dependencies — Vercel serves `public/` and turns `api/*.js`
into functions automatically.

To add the host key afterwards:

```bash
vercel env add GEMINI_API_KEY production
vercel --prod                              # redeploy so it takes effect
```

### Custom domain

```bash
vercel domains add yourdomain.com
```

Or in the dashboard: **Project → Settings → Domains → Add**. Vercel gives you
the DNS records to point at your registrar. Every project also gets a free
`*.vercel.app` domain immediately.

### Run it locally

```bash
npm run web           # http://localhost:3000
```

`public/` is the UI; `api/` holds four endpoints — `status` (what the
deployment has), `detect` (identify a pasted key), `route` (the ranking table)
and `chat` (one routed completion).

Keys pasted in the browser live in `localStorage` and are sent only with that
visitor's own requests. The server stores and logs nothing.

### Editing repos from the web app

Enter `owner/repo` in the **Repository** box and OllyAI works on it directly
through the GitHub API — no clone, no local checkout:

| | |
|---|---|
| **Public repo, no token** | read and search files |
| **+ a GitHub token** | private repos, and committing |

Writes never touch the default branch. The first edit creates an `ollyai/…`
working branch, commits land there, and `gh_open_pr` raises a pull request — so
everything arrives as a reviewable diff.

For a fine-grained PAT, grant **Contents: read and write** and **Pull requests:
read and write** on the repos you want it to reach.

The web app cannot run your tests or a build — there is no filesystem behind it.
For that, use the CLI, which works on a real checkout.

## Working on your own repos

```bash
olly key ghp_your_github_token     # detected as a GitHub token, stored separately
olly
⬢ › /clone HIveAppDeveloper/Hive-app
⬢ › add optimistic updates to the feed and a test for the rollback path
```

`/clone` uses your stored GitHub token, so private repos work. OllyAI edits,
runs your tests, and commits only when you ask it to.

## License

MIT
