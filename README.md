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

The same router, in the browser. `public/` is the UI; `api/` holds three
serverless endpoints — `detect` (identify a pasted key), `route` (the ranking
table), `chat` (one routed completion).

```bash
npm run web           # http://localhost:3000
```

Deploy it:

```bash
npm i -g vercel
vercel                # preview URL
vercel --prod         # production domain
```

No environment variables are needed. **Keys you paste in the web UI stay in
your browser's localStorage** and are sent only with your own requests — the
deployment never stores or logs a visitor's credentials, so anyone can open
your URL and use their own key.

The web app answers questions and writes code, but it cannot touch your
filesystem. Editing files in a repo is the CLI's job.

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
