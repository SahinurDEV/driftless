# Driftless tutorial — billing sample

This walkthrough uses `examples/tutorial-project`, a tiny Node billing module with Jest tests.

## 1. Setup local Driftless

```bash
cd /path/to/driftless
npm install
npm run build:dashboard
npx tsx src/local/cli.ts init --data /tmp/driftless-tutorial
npx tsx src/local/cli.ts repo add examples/tutorial-project --data /tmp/driftless-tutorial
npx tsx src/local/cli.ts serve --data /tmp/driftless-tutorial --port 4747
```

Open http://127.0.0.1:4747

## 2. Generate the first doc from code

```bash
npx tsx src/local/cli.ts docs generate examples/tutorial-project --data /tmp/driftless-tutorial --no-ollama
```

Or in the dashboard: **Docs → From code**.

You get `generated/tutorial-billing.md` (or similar) with `covered_paths` / `covered_names` for `src/billing.js` exports like `createInvoice`.

## 3. Make a code change and see drift

Edit `examples/tutorial-project/src/billing.js` (rename a helper or change behavior). With `serve` running, the file watcher queues a drift check. Open **Drift** — a flag should appear for the generated doc.

## 4. Alerts

In **Settings → Drift alerts**, paste a Slack or Discord incoming webhook URL, Save, then **Send test**. Real drift flags also notify that webhook.

## 5. Assign and comment

On the Drift page, add a team name (e.g. `Asha`), assign the flag, leave a comment. Filter by assignee.

## 6. Test failure → drift

```bash
cd examples/tutorial-project
npm install
# break a test temporarily, then:
DRIFTLESS_JUNIT=junit.xml npm run test:junit || true
cd ../..
npx tsx src/local/cli.ts test-report examples/tutorial-project/junit.xml --data /tmp/driftless-tutorial
```

Failing tests whose file/name match covered paths/names open a drift flag with reason `test failed: …`.

## 7. Version history and rollback

Edit the doc in the dashboard, Save twice, open **History**, Diff, then **Rollback** to an older version (creates a new version).

## 8. Multi-repo overview & search

Open **Overview** for ok/stale/review counts. In the project, **Search → Reindex code**, then search for `createInvoice` across docs and code.

## 9. Keep cloud deploy

The same repo still deploys with `npx wrangler deploy`. Local mode and Cloudflare share one codebase.
