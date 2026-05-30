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
