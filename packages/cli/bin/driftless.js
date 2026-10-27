#!/usr/bin/env node
/**
 * Minimal CLI stub — sync is a contributor idea / nice-to-have.
 * Usage:
 *   driftless export --url https://… --token dl_… --project <id> --out ./docs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const cmd = args[0];

function flag(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

if (cmd === 'export') {
  const url = flag('--url')?.replace(/\/$/, '');
  const token = flag('--token');
  const project = flag('--project');
  const out = flag('--out') || './docs';
  if (!url || !token || !project) {
    console.error('Usage: driftless export --url <base> --token dl_… --project <id> [--out ./docs]');
    process.exit(1);
  }
  const res = await fetch(`${url}/api/projects/${project}/export`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    console.error(await res.text());
    process.exit(1);
  }
  const data = await res.json();
  for (const f of data.files ?? []) {
    const path = join(out, f.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, f.content);
    console.log('wrote', path);
  }
} else {
  console.log(`Driftless CLI

Commands:
  export  Download project markdown (sync upload not implemented yet)

Contributor idea: bi-directional folder sync like Dropbox.
`);
}
