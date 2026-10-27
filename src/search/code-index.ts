import { readFile, readdir, access } from 'node:fs/promises';
import { join, relative, extname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { Env } from '../types';
import { newId } from '../util/id';
import { nowIso } from '../util/time';
import { searchDocs } from '../storage/docs';

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.driftless',
  'vendor', '__pycache__', '.venv', 'target', '.turbo', '.cache', 'dashboard/dist',
]);

const TEXT_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java',
  '.kt', '.rb', '.php', '.cs', '.swift', '.md', '.mdx', '.json', '.yml', '.yaml',
  '.toml', '.sql', '.css', '.scss', '.html', '.txt', '.sh', '.env.example',
]);

const MAX_FILE = 200_000;
const MAX_FILES = 500;

async function loadGitignore(root: string): Promise<(p: string) => boolean> {
  const patterns: string[] = [];
  const gi = join(root, '.gitignore');
  if (existsSync(gi)) {
    const text = await readFile(gi, 'utf8');
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      patterns.push(t.replace(/\/$/, ''));
    }
  }
  return (rel: string) => {
    for (const p of patterns) {
      if (p.startsWith('!')) continue;
      if (rel === p || rel.startsWith(p + '/') || rel.includes('/' + p + '/') || basename(rel) === p)
        return true;
      if (p.includes('*')) {
        const esc = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*');
        if (new RegExp('^' + esc).test(rel)) return true;
      }
    }
    return false;
  };
}

async function walk(dir: string, root: string, ignored: (p: string) => boolean, out: string[] = [], depth = 0): Promise<string[]> {
  if (depth > 10 || out.length >= MAX_FILES) return out;
  let ents;
  try {
    ents = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of ents) {
    if (out.length >= MAX_FILES) break;
    if (ent.name.startsWith('.') && ent.name !== '.env.example') continue;
    if (SKIP_DIRS.has(ent.name)) continue;
    const full = join(dir, ent.name);
    const rel = relative(root, full).replace(/\\/g, '/');
    if (ignored(rel)) continue;
    if (ent.isDirectory()) await walk(full, root, ignored, out, depth + 1);
    else if (TEXT_EXT.has(extname(ent.name)) || ent.name === 'Dockerfile') out.push(full);
  }
  return out;
}

export async function indexRepoCode(
  env: Env,
  opts: { projectId: string; repoId: string; localPath: string },
): Promise<{ indexed: number }> {
  await access(opts.localPath);
  const ignored = await loadGitignore(opts.localPath);
  const files = await walk(opts.localPath, opts.localPath, ignored);
  let indexed = 0;
  const ts = nowIso();

  // Clear previous FTS rows for this repo (FTS5 has no simple UPDATE by key)
  await env.DB.prepare(`DELETE FROM code_fts WHERE project_id = ? AND repo_id = ?`)
    .bind(opts.projectId, opts.repoId)
    .run();

  for (const full of files) {
    const rel = relative(opts.localPath, full).replace(/\\/g, '/');
    let content: string;
    try {
      content = await readFile(full, 'utf8');
    } catch {
      continue;
    }
    if (content.length > MAX_FILE) content = content.slice(0, MAX_FILE);
    // skip likely binary
    if (content.includes('\0')) continue;
    const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
    const id = newId('cf');
    await env.DB.prepare(
      `INSERT INTO code_files (id, project_id, repo_id, path, content_hash, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, repo_id, path) DO UPDATE SET content_hash = excluded.content_hash, indexed_at = excluded.indexed_at`,
    )
      .bind(id, opts.projectId, opts.repoId, rel, hash, ts)
      .run();
    await env.DB.prepare(
      `INSERT INTO code_fts (project_id, repo_id, path, body) VALUES (?, ?, ?, ?)`,
    )
      .bind(opts.projectId, opts.repoId, rel, content)
      .run();
    indexed++;
  }
  return { indexed };
}

export async function searchCode(
  env: Env,
  projectId: string,
  query: string,
  limit = 20,
): Promise<{ path: string; repo_id: string; snippet: string }[]> {
  const q = query.trim();
  if (!q) return [];
  const tokens = q
    .split(/\s+/)
    .map((t) => t.replace(/["']/g, ''))
    .filter(Boolean)
    .map((t) => `"${t}"*`)
    .join(' OR ');
  if (!tokens) return [];
  const rows = await env.DB.prepare(
    `SELECT path, repo_id, snippet(code_fts, 3, '', '', '…', 14) AS snippet
     FROM code_fts WHERE project_id = ? AND code_fts MATCH ? LIMIT ?`,
  )
    .bind(projectId, tokens, limit)
    .all<{ path: string; repo_id: string; snippet: string }>();
  return rows.results ?? [];
}

export async function searchAll(
  env: Env,
  projectId: string,
  query: string,
  limit = 20,
): Promise<{
  docs: { doc_id: string; title: string; snippet: string }[];
  code: { path: string; repo_id: string; snippet: string }[];
}> {
  const half = Math.max(5, Math.floor(limit / 2));
  const [docs, code] = await Promise.all([
    searchDocs(env, projectId, query, half),
    searchCode(env, projectId, query, half),
  ]);
  return { docs, code };
}
