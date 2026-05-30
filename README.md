# OpenCode Dashboard

Local dashboard for token usage stored in OpenCode's SQLite database.

## Run From GitHub

```sh
bunx github:applauselab/opencode-dashboard#main
```

Then open `http://localhost:4173`.

If your shell accepts GitHub shorthand, this also works:

```sh
bunx applauselab/opencode-dashboard#main
```

## Run Locally

```sh
bun run dev
```

Open `http://localhost:4173`.

By default it reads `~/.local/share/opencode/opencode.db`. To point at another database:

```sh
OPENCODE_DB="$HOME/.local/share/opencode/opencode-local.db" bunx github:applauselab/opencode-dashboard#main
```

You can also change the port:

```sh
PORT=4174 bunx github:applauselab/opencode-dashboard#main
```

## Shows

- Token usage over time per project
- Daily token usage split by input, output, reasoning, cache read, and cache write tokens
- Top projects and a daily breakdown table
- Known costs by day, provider, model, and project

## Cost Data

The dashboard uses `session.cost` when OpenCode records it. If that value is missing, it uses official public pricing only for exact model matches currently included in `server.ts`:

- OpenAI GPT-5.5 and GPT-5.4 from `https://openai.com/api/pricing/`
- Anthropic Claude Opus 4.7 from `https://www.anthropic.com/pricing#api`

Models that do not have an exact public price match are shown as `N/A` unless you provide custom pricing:

```sh
OPENCODE_PRICING_JSON='{"provider:model":{"label":"My model","input":1,"output":5,"cacheRead":0.1,"cacheWrite":1,"reasoning":5,"source":"custom"}}' bunx github:ApplauseLab/opencode-dashboard#main
```
