# Deploy notes

Use the Deploy to Cloudflare button in the README, or follow the README "Deploy to Cloudflare" section.

Required wrangler resources:

- Worker: `driftless`
- D1: `driftless`
- R2: `driftless-docs`
- Queue: `driftless-jobs`
- Optional: Vectorize index `driftless-embeddings` (768 dims, cosine) + Workers AI binding
