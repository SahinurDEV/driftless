#!/usr/bin/env node
import { mkdir, readFile, writeFile, cp, access } from 'node:fs/promises';
import { dirname, join, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { absPath, loadConfig, resolveDataDir } from './config';
import {
  createLocalEnv,
  ensureDataDir,
  writeConfigMeta,
  LOCAL_USER_ID,
  createLocalSession,
} from './bootstrap';
import { startLocalServer } from './server';
import { runMcpStdio } from './mcp-stdio';
import { exportProjectMarkdown, saveDoc } from '../storage/docs';
import { newId } from '../util/id';
import { nowIso } from '../util/time';
import { createApiKey } from '../auth/keys';
import { generateDocFromRepo } from '../docs/generate';
import { parseJUnitXml, ingestTestFailures } from '../tests-ingest/junit';
import { indexRepoCode } from '../search/code-index';
import { listDocVersions, rollbackDoc } from '../storage/versions';
import { readDocVersion } from '../storage/docs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
function has(args: string[], name: string): boolean {
  return args.includes(name);
}

function migrationsDir(): string {
  const candidates = [
    join(REPO_ROOT, 'migrations'),
    join(process.cwd(), 'migrations'),
    join(__dirname, '../../migrations'),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return join(REPO_ROOT, 'migrations');
}

function dashboardDir(): string {
  const candidates = [
    join(REPO_ROOT, 'dashboard/dist'),
    join(process.cwd(), 'dashboard/dist'),
  ];
  for (const c of candidates) if (existsSync(join(c, 'index.html'))) return c;
  return join(REPO_ROOT, 'dashboard/dist');
}

function usage(): never {
  console.log(`Driftless — living docs (local mode)

Usage:
  driftless init [--data <dir>] [--password <pass>]
  driftless serve [--port 4747] [--data <dir>] [--password <pass>]
  driftless mcp [--data <dir>] [--token dl_…]
  driftless repo add <path> [--project <id>] [--data <dir>]
  driftless repo list [--data <dir>]
  driftless repo remove <repoId> [--data <dir>]
  driftless hook install [<git-repo-path>]
  driftless export [--project <id>] [--out ./docs] [--data <dir>]
  driftless import <folder> [--project <id>] [--data <dir>]
  driftless docs generate <repo-path> [--project <id>] [--data <dir>] [--no-ollama]
  driftless versions <docId> [--project <id>] [--data <dir>]
  driftless rollback <docId> <version> [--project <id>] [--data <dir>]
  driftless test-report <junit.xml> [--project <id>] [--repo <id>] [--data <dir>]
  driftless test -- <cmd...>   # run command then ingest junit if DRIFTLESS_JUNIT set
  driftless reindex [--project <id>] [--data <dir>]

Run fully offline — no GitHub, no Cloudflare required.
Cloudflare deploy of this same repo still works unchanged.
`);
  process.exit(0);
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  if (!cmd || cmd === '-h' || cmd === '--help') usage();

  const dataFlag = flag(args, '--data');
  const port = Number(flag(args, '--port') || 4747);
  const password = flag(args, '--password');

  if (cmd === 'init') {
    const cfg = loadConfig({ dataDir: dataFlag, password });
    await ensureDataDir(cfg);
    const { projectId, workspaceId } = await createLocalEnv(cfg, migrationsDir());
    await writeConfigMeta(cfg);
    console.log(`Initialized Driftless data at ${cfg.dataDir}`);
    console.log(`Workspace: ${workspaceId}`);
    console.log(`Default project: ${projectId}`);
    console.log(`Next: driftless serve`);
    return;
  }

  if (cmd === 'serve') {
    const cfg = loadConfig({ dataDir: dataFlag, port, password });
    if (!existsSync(cfg.dbPath)) {
      console.log('No data dir yet — running init…');
      await ensureDataDir(cfg);
      await writeConfigMeta(cfg);
    }
    const { env } = await createLocalEnv(cfg, migrationsDir());
    if (password) await writeConfigMeta(cfg);
    const dash = dashboardDir();
    if (!existsSync(join(dash, 'index.html'))) {
      console.warn(`Dashboard not found at ${dash}. Run: npm run build:dashboard`);
    }
    const server = await startLocalServer(env, cfg, { dashboardDir: dash });
    const shutdown = async () => {
      await server.close();
      process.exit(0);
    };
    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
    await new Promise(() => {});
    return;
  }

  if (cmd === 'mcp') {
    const cfg = loadConfig({ dataDir: dataFlag });
    const { env } = await createLocalEnv(cfg, migrationsDir());
    const token = flag(args, '--token') || process.env.DRIFTLESS_API_KEY;
    await runMcpStdio(env, token);
    return;
  }

  if (cmd === 'repo') {
    const sub = args[1];
    const cfg = loadConfig({ dataDir: dataFlag });
    const { env, projectId: defaultProject } = await createLocalEnv(cfg, migrationsDir());
    const projectId = flag(args, '--project') || defaultProject;

    if (sub === 'add') {
      const pathArg = args[2];
      if (!pathArg) {
        console.error('Usage: driftless repo add <path>');
        process.exit(1);
      }
      const localPath = absPath(pathArg);
      try {
        await access(localPath);
      } catch {
        console.error(`Path not found: ${localPath}`);
        process.exit(1);
      }
      const name = basename(localPath);
      const id = newId('repo');
      const ts = nowIso();
      await env.DB.prepare(
        `INSERT INTO repos (id, project_id, github_owner, github_name, default_branch, local_path, created_at, updated_at)
         VALUES (?, ?, 'local', ?, 'main', ?, ?, ?)`,
      )
        .bind(id, projectId, name, localPath, ts, ts)
        .run();
      console.log(`Added local repo ${name} (${id})`);
      console.log(`  path: ${localPath}`);
      console.log(`  project: ${projectId}`);
      return;
    }

    if (sub === 'list') {
      const rows = await env.DB.prepare(
        `SELECT id, project_id, github_owner, github_name, local_path FROM repos ORDER BY created_at`,
      ).all();
      console.log(JSON.stringify(rows.results ?? [], null, 2));
      return;
    }

    if (sub === 'remove') {
      const id = args[2];
      if (!id) {
        console.error('Usage: driftless repo remove <repoId>');
        process.exit(1);
      }
      await env.DB.prepare(`DELETE FROM repos WHERE id = ?`).bind(id).run();
      console.log('Removed', id);
      return;
    }

    console.error('Usage: driftless repo add|list|remove');
    process.exit(1);
  }

  if (cmd === 'hook') {
    if (args[1] !== 'install') {
      console.error('Usage: driftless hook install [git-repo-path]');
      process.exit(1);
    }
    const repoPath = absPath(args[2] || '.');
    const hookDir = join(repoPath, '.git/hooks');
    if (!existsSync(join(repoPath, '.git'))) {
      console.error(`Not a git repo: ${repoPath}`);
      process.exit(1);
    }
    await mkdir(hookDir, { recursive: true });
    const hookPath = join(hookDir, 'post-commit');
    const dataDir = resolveDataDir(dataFlag);
    const script = `#!/bin/sh
# Driftless post-commit — notify local server of changed files
ROOT="${repoPath}"
DATA="${dataDir}"
CHANGED=$(git -C "$ROOT" diff-tree --no-commit-id --name-only -r HEAD 2>/dev/null)
if [ -z "$CHANGED" ]; then exit 0; fi
# Best-effort HTTP ping if server is up
PAYLOAD=$(printf '%s' "$CHANGED" | python3 -c 'import sys,json; print(json.dumps({"paths":sys.stdin.read().splitlines()}))' 2>/dev/null)
curl -sS -X POST "http://127.0.0.1:4747/api/local/drift-ping" \\
  -H "Content-Type: application/json" \\
  -d "{\\"repo_path\\":\\"$ROOT\\",\\"paths\\":$(printf '%s' "$CHANGED" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read().splitlines()))')}" \\
  >/dev/null 2>&1 || true
`;
    await writeFile(hookPath, script, { mode: 0o755 });
    console.log(`Installed post-commit hook at ${hookPath}`);
    console.log('File watcher in `driftless serve` also detects changes without the hook.');
    return;
  }

  if (cmd === 'export') {
    const cfg = loadConfig({ dataDir: dataFlag });
    const { env, projectId: defaultProject } = await createLocalEnv(cfg, migrationsDir());
    const projectId = flag(args, '--project') || defaultProject;
    const out = absPath(flag(args, '--out') || './docs-export');
    const files = await exportProjectMarkdown(env, projectId);
    for (const f of files) {
      const path = join(out, f.path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, f.content);
      console.log('wrote', path);
    }
    console.log(`Exported ${files.length} files to ${out}`);
    return;
  }

  if (cmd === 'import') {
    const folder = args[1];
    if (!folder) {
      console.error('Usage: driftless import <folder>');
      process.exit(1);
    }
    const cfg = loadConfig({ dataDir: dataFlag });
    const { env, projectId: defaultProject } = await createLocalEnv(cfg, migrationsDir());
    const projectId = flag(args, '--project') || defaultProject;
    const root = absPath(folder);
    const { readdir } = await import('node:fs/promises');
    async function walk(dir: string, base: string): Promise<string[]> {
      const out: string[] = [];
      for (const ent of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, ent.name);
        if (ent.isDirectory()) out.push(...(await walk(full, base)));
        else if (ent.name.endsWith('.md')) out.push(full);
      }
      return out;
    }
    const files = await walk(root, root);
    for (const full of files) {
      const rel = full.slice(root.length + 1).replace(/\\/g, '/');
      const content = await readFile(full, 'utf8');
      const docId = newId('doc');
      const result = await saveDoc(env, {
        projectId,
        docId,
        path: rel,
        content,
        baseVersion: null,
        authorId: LOCAL_USER_ID,
        authorType: 'user',
      });
      if (!result.ok) {
        // update existing by path
        const existing = await env.DB.prepare(
          `SELECT id, current_version FROM docs WHERE project_id = ? AND path = ?`,
        )
          .bind(projectId, rel)
          .first<{ id: string; current_version: number }>();
        if (existing) {
          await saveDoc(env, {
            projectId,
            docId: existing.id,
            path: rel,
            content,
            baseVersion: existing.current_version,
            authorId: LOCAL_USER_ID,
            authorType: 'user',
          });
          console.log('updated', rel);
        } else {
          console.error('skip', rel, result.error);
        }
      } else {
        console.log('imported', rel);
      }
    }
    return;
  }


  if (cmd === 'docs') {
    const sub = args[1];
    if (sub !== 'generate') {
      console.error('Usage: driftless docs generate <repo-path>');
      process.exit(1);
    }
    const repoPath = absPath(args[2] || '.');
    const cfg = loadConfig({ dataDir: dataFlag });
    const { env, projectId: defaultProject } = await createLocalEnv(cfg, migrationsDir());
    const projectId = flag(args, '--project') || defaultProject;
    const generated = await generateDocFromRepo(repoPath, { useOllama: !has(args, '--no-ollama') });
    // attach to matching local repo if present
    const repos = await env.DB.prepare(
      `SELECT id, local_path FROM repos WHERE project_id = ? AND local_path IS NOT NULL`,
    )
      .bind(projectId)
      .all<{ id: string; local_path: string }>();
    const hit = (repos.results ?? []).find(
      (r) => r.local_path === repoPath || repoPath.startsWith(r.local_path),
    );
    const docId = newId('doc');
    let result = await saveDoc(env, {
      projectId,
      docId,
      path: generated.path,
      content: generated.content,
      baseVersion: null,
      authorId: LOCAL_USER_ID,
      authorType: 'system',
      summary: 'Generated from code',
      repoId: hit?.id ?? null,
    });
    if (!result.ok) {
      const existing = await env.DB.prepare(
        `SELECT id, current_version FROM docs WHERE project_id = ? AND path = ?`,
      )
        .bind(projectId, generated.path)
        .first<{ id: string; current_version: number }>();
      if (existing) {
        result = await saveDoc(env, {
          projectId,
          docId: existing.id,
          path: generated.path,
          content: generated.content,
          baseVersion: existing.current_version,
          authorId: LOCAL_USER_ID,
          authorType: 'system',
          summary: 'Regenerated from code',
          repoId: hit?.id ?? null,
        });
        console.log('Updated', generated.path, existing.id, 'v' + (result.ok ? result.version : '?'));
      } else {
        console.error(result.error);
        process.exit(1);
      }
    } else {
      console.log('Created', generated.path, docId);
    }
    console.log('covered_paths:', generated.covered_paths.length, 'covered_names:', generated.covered_names.length);
    return;
  }

  if (cmd === 'versions') {
    const docId = args[1];
    if (!docId) {
      console.error('Usage: driftless versions <docId>');
      process.exit(1);
    }
    const cfg = loadConfig({ dataDir: dataFlag });
    const { env } = await createLocalEnv(cfg, migrationsDir());
    const versions = await listDocVersions(env, docId);
    console.log(JSON.stringify(versions, null, 2));
    return;
  }

  if (cmd === 'rollback') {
    const docId = args[1];
    const toVersion = Number(args[2]);
    if (!docId || !toVersion) {
      console.error('Usage: driftless rollback <docId> <version>');
      process.exit(1);
    }
    const cfg = loadConfig({ dataDir: dataFlag });
    const { env, projectId: defaultProject } = await createLocalEnv(cfg, migrationsDir());
    const projectId = flag(args, '--project') || defaultProject;
    const meta = await env.DB.prepare(
      `SELECT path, current_version FROM docs WHERE id = ? AND project_id = ?`,
    )
      .bind(docId, projectId)
      .first<{ path: string; current_version: number }>();
    if (!meta) {
      console.error('Doc not found');
      process.exit(1);
    }
    const result = await rollbackDoc(env, {
      projectId,
      docId,
      path: meta.path,
      toVersion,
      currentVersion: meta.current_version,
      authorId: LOCAL_USER_ID,
    });
    if (!result.ok) {
      console.error(result.error);
      process.exit(1);
    }
    console.log('Rolled back to v' + toVersion + ' as new v' + result.version);
    return;
  }

  if (cmd === 'test-report') {
    const file = args[1];
    if (!file) {
      console.error('Usage: driftless test-report <junit.xml>');
      process.exit(1);
    }
    const cfg = loadConfig({ dataDir: dataFlag });
    const { env, projectId: defaultProject } = await createLocalEnv(cfg, migrationsDir());
    const projectId = flag(args, '--project') || defaultProject;
    const repoId = flag(args, '--repo');
    const xml = await readFile(absPath(file), 'utf8');
    const failures = parseJUnitXml(xml);
    const result = await ingestTestFailures(env, {
      projectId,
      repoId,
      failures,
      commitSha: `cli-${Date.now()}`,
    });
    console.log(JSON.stringify({ failures: failures.length, ...result }, null, 2));
    return;
  }

  if (cmd === 'test') {
    const dash = args.indexOf('--');
    const cmdArgs = dash >= 0 ? args.slice(dash + 1) : args.slice(1);
    if (!cmdArgs.length) {
      console.error('Usage: driftless test -- <command...>');
      process.exit(1);
    }
    const { spawn } = await import('node:child_process');
    const junit = process.env.DRIFTLESS_JUNIT || flag(args, '--junit') || 'junit.xml';
    const code: number = await new Promise((resolve) => {
      const child = spawn(cmdArgs[0], cmdArgs.slice(1), { stdio: 'inherit', shell: true });
      child.on('close', (c) => resolve(c ?? 1));
    });
    if (existsSync(junit)) {
      const cfg = loadConfig({ dataDir: dataFlag });
      const { env, projectId: defaultProject } = await createLocalEnv(cfg, migrationsDir());
      const projectId = flag(args, '--project') || defaultProject;
      const xml = await readFile(junit, 'utf8');
      const failures = parseJUnitXml(xml);
      const result = await ingestTestFailures(env, { projectId, failures });
      console.log('Ingested test report:', { failures: failures.length, ...result });
    } else {
      console.log(`No junit file at ${junit} (set DRIFTLESS_JUNIT)`);
    }
    process.exit(code);
  }

  if (cmd === 'reindex') {
    const cfg = loadConfig({ dataDir: dataFlag });
    const { env, projectId: defaultProject } = await createLocalEnv(cfg, migrationsDir());
    const projectId = flag(args, '--project') || defaultProject;
    const repos = await env.DB.prepare(
      `SELECT id, local_path FROM repos WHERE project_id = ? AND local_path IS NOT NULL`,
    )
      .bind(projectId)
      .all<{ id: string; local_path: string }>();
    let total = 0;
    for (const r of repos.results ?? []) {
      const res = await indexRepoCode(env, { projectId, repoId: r.id, localPath: r.local_path });
      console.log('Indexed', r.local_path, res.indexed, 'files');
      total += res.indexed;
    }
    console.log('Total', total);
    return;
  }

  usage();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
