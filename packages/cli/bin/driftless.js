#!/usr/bin/env node
/**
 * Driftless CLI entry. Prefers compiled dist, falls back to tsx from repo checkout.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '../../..');
const dist = join(root, 'dist/cli/cli.js');
const src = join(root, 'src/local/cli.ts');

if (existsSync(dist)) {
  await import(pathToFileURL(dist).href);
} else if (existsSync(src)) {
  const require = createRequire(import.meta.url);
  let tsxBin;
  try {
    tsxBin = require.resolve('tsx/cli');
  } catch {
    console.error('Driftless: run `npm install` in the repo (tsx required for source mode).');
    process.exit(1);
  }
  const r = spawnSync(process.execPath, [tsxBin, src, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: process.env,
  });
  process.exit(r.status ?? 1);
} else {
  console.error('Driftless CLI not found. Build with npm run build:cli or clone the repo.');
  process.exit(1);
}
