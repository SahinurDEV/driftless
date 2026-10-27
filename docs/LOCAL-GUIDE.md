# Run Driftless fully locally

No GitHub, no CI/CD, no Cloudflare required. The same repo still deploys to Cloudflare when you want a shared team server.

## Install

From a clone:

```bash
git clone https://github.com/SahinurDEV/driftless
cd driftless
npm install
npm run build:dashboard
```

Run the CLI without a global install:

```bash
npx tsx src/local/cli.ts --help
# or after linking:
npm link
driftless --help
```

You can also try:

```bash
npx github:SahinurDEV/driftless
```

(npm publish may not be available; prefer clone + `npm link` or `npx tsx src/local/cli.ts`.)

## Quick start

```bash
# 1. Create ~/.driftless (or ./.driftless) with SQLite + docs storage
driftless init
# optional: driftless init --data ./my-data --password secret

# 2. Start dashboard + API + MCP on http://127.0.0.1:4747
driftless serve
# optional: --port 4747 --data ./my-data --password secret
```

Open **http://127.0.0.1:4747**. Bound to localhost only. With no `--password`, you are signed in automatically as the local user. API keys still work for MCP.

## Add a local repo (folder)

CLI:

```bash
driftless repo add ./path/to/your/code
driftless repo list
```

Or in the dashboard: **Settings → Local folders / repos → Add folder** (absolute path).

The server watches those folders with chokidar (debounced). Optionally install a git hook:

```bash
driftless hook install ./path/to/your/code
```

The hook posts changed paths to `/api/local/drift-ping` when the server is running. The file watcher works even without the hook.

## Write a doc with coverage

In the dashboard **Docs** page (or via API/MCP), create markdown with YAML frontmatter:

```markdown
---
title: Drift matching
covered_paths:
  - src/drift/**
covered_names:
  - runDriftCheck
---

# Drift matching

Explain the code this doc covers…
```

- `covered_paths` — glob/prefix patterns relative to the repo root  
- `covered_names` — symbols, endpoints, or keywords to match  

## How drift alerts happen

1. You edit a file under a covered path (or a covered name changes).  
2. The watcher (or git hook) queues the same `drift_check` job used in cloud mode.  
3. Matching docs get an open **drift flag** and `drift_status: stale`.  
4. Open **Drift** in the dashboard to see why (path/name match + changed files).

No AI is required for flagging.

## Review queue

Trust modes (`review` / `auto` / `trust`) work the same as in cloud:

- Agent or auto edits may land in **Review** for approval.  
- You can dismiss false-positive drift flags from the Drift page.  
- After you update a stale doc, its status returns toward `ok`.

## Connect Cursor or Claude (MCP)

Create a write API key in **Settings → API keys**, then use either transport.

### MCP over stdio (Cursor / Claude Desktop)

```json
{
  "mcpServers": {
    "driftless": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/driftless/src/local/cli.ts", "mcp", "--data", "/home/you/.driftless", "--token", "dl_YOUR_KEY"]
    }
  }
}
```

If you `npm link`’d the CLI:

```json
{
  "mcpServers": {
    "driftless": {
      "command": "driftless",
      "args": ["mcp", "--token", "dl_YOUR_KEY"]
    }
  }
}
```

### MCP over HTTP

Keep `driftless serve` running, then point an HTTP MCP client at:

```
http://127.0.0.1:4747/mcp
```

Authorization: `Bearer dl_YOUR_KEY`.

Example tool call: `search_docs` with `{ "project_id": "proj_…", "query": "billing" }`.

## Export / import markdown

```bash
driftless export --out ./docs-export
driftless import ./docs-export
```

Export is also available in the dashboard (**Settings → Export markdown**).

## Data directory

Default: `./.driftless` if present, otherwise `~/.driftless`.

Override with `--data <dir>` or `DRIFTLESS_DATA`.

Layout:

```
data/
  driftless.db      # SQLite + FTS5
  docs/             # markdown versions
  config.json       # optional password hash
```

## Troubleshooting

| Problem | Fix |
|--------|-----|
| Dashboard 503 / blank | Run `npm run build:dashboard` then restart `serve` |
| Port in use | `driftless serve --port 4748` |
| No drift after edit | Confirm repo path is absolute and `covered_paths` match paths relative to that folder; check server logs |
| MCP unauthorized | Pass `--token dl_…` or create a key in Settings |
| Want a password | `driftless serve --password secret` (stores hash in config.json) |
| Reset everything | Stop server, delete the data dir, `driftless init` again |

## Cloudflare unchanged

Local mode adds adapters and a CLI. The Worker (`wrangler deploy`), D1, R2, Queues, and GitHub OAuth path remain the default cloud deployment. See the root [README](../README.md) for deploy steps.
