# Getting started

Driftless keeps shared markdown docs aligned with code across repos.

## Choose a mode

- **Local** — `driftless serve` on your machine (recommended for private work).
- **Cloudflare** — shared team server at your Worker URL.

```bash
git clone https://github.com/SahinurDEV/driftless
cd driftless
npm install
npm run build:dashboard
npx tsx src/local/cli.ts init
npx tsx src/local/cli.ts serve
```

Open http://127.0.0.1:4747

Next: [Local mode](./local-mode) · [Tutorial](./tutorial)
