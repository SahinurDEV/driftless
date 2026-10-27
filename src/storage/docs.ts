import type { Env } from '../types';
import { hashContent } from '../util/hash';
import { newId } from '../util/id';
import { nowIso } from '../util/time';
import { parseFrontmatter } from '../util/markdown';

export function r2Key(projectId: string, docId: string, version: number): string {
  return `projects/${projectId}/docs/${docId}/v${version}.md`;
}

export async function readDocVersion(
  env: Env,
  projectId: string,
  docId: string,
  version: number,
): Promise<string | null> {
  const obj = await env.DOCS.get(r2Key(projectId, docId, version));
  if (!obj) return null;
  return obj.text();
}

export interface SaveDocInput {
  projectId: string;
  docId: string;
  path: string;
  content: string;
  baseVersion: number | null; // null = create
  authorId: string | null;
  authorType: 'user' | 'agent' | 'system';
  summary?: string;
  repoId?: string | null;
}

export type SaveDocResult =
  | {
      ok: true;
      version: number;
      contentHash: string;
      title: string;
      coveredPaths: string[];
      coveredNames: string[];
    }
  | { ok: false; error: 'version_conflict'; currentVersion: number }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: string };

/**
 * Optimistic concurrency: if baseVersion is set, it must equal docs.current_version.
 */
export async function saveDoc(env: Env, input: SaveDocInput): Promise<SaveDocResult> {
  const existing = await env.DB.prepare(
    `SELECT id, current_version, path FROM docs WHERE id = ? AND project_id = ?`,
  )
    .bind(input.docId, input.projectId)
    .first<{ id: string; current_version: number; path: string }>();

  if (input.baseVersion === null) {
    if (existing) {
      return { ok: false, error: 'Doc already exists' };
    }
  } else {
    if (!existing) return { ok: false, error: 'not_found' };
    if (existing.current_version !== input.baseVersion) {
      return {
        ok: false,
        error: 'version_conflict',
        currentVersion: existing.current_version,
      };
    }
  }

  const { frontmatter, body } = parseFrontmatter(input.content);
  const title =
    frontmatter.title ||
    input.path.split('/').pop()?.replace(/\.md$/i, '') ||
    'Untitled';
  const coveredPaths = frontmatter.covered_paths ?? [];
  const coveredNames = frontmatter.covered_names ?? [];
  const contentHash = await hashContent(input.content);
  const nextVersion = existing ? existing.current_version + 1 : 1;
  const key = r2Key(input.projectId, input.docId, nextVersion);
  const ts = nowIso();

  await env.DOCS.put(key, input.content, {
    httpMetadata: { contentType: 'text/markdown; charset=utf-8' },
    customMetadata: {
      projectId: input.projectId,
      docId: input.docId,
      version: String(nextVersion),
      contentHash,
    },
  });

  const versionId = newId('dv');

  if (!existing) {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO docs (id, project_id, repo_id, path, title, covered_paths, covered_names, current_version, drift_status, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ok', ?, ?, ?, ?)`,
      ).bind(
        input.docId,
        input.projectId,
        input.repoId ?? null,
        input.path,
        title,
        JSON.stringify(coveredPaths),
        JSON.stringify(coveredNames),
        nextVersion,
        input.authorId,
        input.authorId,
        ts,
        ts,
      ),
      env.DB.prepare(
        `INSERT INTO doc_versions (id, doc_id, version, r2_key, author_id, author_type, summary, content_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        versionId,
        input.docId,
        nextVersion,
        key,
        input.authorId,
        input.authorType,
        input.summary ?? null,
        contentHash,
        ts,
      ),
    ]);
  } else {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE docs SET title = ?, covered_paths = ?, covered_names = ?, current_version = ?, updated_by = ?, updated_at = ?, drift_status = CASE WHEN drift_status = 'stale' THEN 'ok' ELSE drift_status END
         WHERE id = ? AND current_version = ?`,
      ).bind(
        title,
        JSON.stringify(coveredPaths),
        JSON.stringify(coveredNames),
        nextVersion,
        input.authorId,
        ts,
        input.docId,
        input.baseVersion,
      ),
      env.DB.prepare(
        `INSERT INTO doc_versions (id, doc_id, version, r2_key, author_id, author_type, summary, content_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        versionId,
        input.docId,
        nextVersion,
        key,
        input.authorId,
        input.authorType,
        input.summary ?? null,
        contentHash,
        ts,
      ),
    ]);

    // Re-check optimistic lock after update
    const check = await env.DB.prepare(`SELECT current_version FROM docs WHERE id = ?`)
      .bind(input.docId)
      .first<{ current_version: number }>();
    if (!check || check.current_version !== nextVersion) {
      return {
        ok: false,
        error: 'version_conflict',
        currentVersion: check?.current_version ?? input.baseVersion!,
      };
    }
  }

  await upsertFts(env, input.docId, input.projectId, title, body, coveredNames);

  return {
    ok: true,
    version: nextVersion,
    contentHash,
    title,
    coveredPaths,
    coveredNames,
  };
}

export async function upsertFts(
  env: Env,
  docId: string,
  projectId: string,
  title: string,
  body: string,
  names: string[],
): Promise<void> {
  await env.DB.prepare(`DELETE FROM docs_fts WHERE doc_id = ?`).bind(docId).run();
  await env.DB.prepare(
    `INSERT INTO docs_fts (doc_id, project_id, title, body, names) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(docId, projectId, title, body.slice(0, 100_000), names.join(' '))
    .run();
}

export async function searchDocs(
  env: Env,
  projectId: string,
  query: string,
  limit = 20,
): Promise<{ doc_id: string; title: string; snippet: string }[]> {
  const q = query.trim();
  if (!q) return [];
  // Escape FTS5 special chars simply by quoting tokens
  const tokens = q
    .split(/\s+/)
    .map((t) => t.replace(/["']/g, ''))
    .filter(Boolean)
    .map((t) => `"${t}"*`)
    .join(' OR ');
  if (!tokens) return [];

  const rows = await env.DB.prepare(
    `SELECT docs_fts.doc_id AS doc_id, docs_fts.title AS title,
            snippet(docs_fts, 3, '', '', '…', 12) AS snippet
     FROM docs_fts
     WHERE docs_fts.project_id = ? AND docs_fts MATCH ?
     LIMIT ?`,
  )
    .bind(projectId, tokens, limit)
    .all<{ doc_id: string; title: string; snippet: string }>();

  return rows.results ?? [];
}

export async function exportProjectMarkdown(
  env: Env,
  projectId: string,
): Promise<{ path: string; content: string }[]> {
  const docs = await env.DB.prepare(
    `SELECT id, path, current_version FROM docs WHERE project_id = ? ORDER BY path`,
  )
    .bind(projectId)
    .all<{ id: string; path: string; current_version: number }>();

  const out: { path: string; content: string }[] = [];
  for (const d of docs.results ?? []) {
    const content = await readDocVersion(env, projectId, d.id, d.current_version);
    if (content != null) out.push({ path: d.path, content });
  }
  return out;
}
