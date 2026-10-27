# Cloudflare deploy

![Cloudflare architecture](/diagrams/architecture-cloudflare.svg)

```bash
npx wrangler login
npm run build:dashboard
npx wrangler d1 migrations apply driftless --remote
npx wrangler deploy
```

Configure GitHub OAuth and secrets as described in the root README.
