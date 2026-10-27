import { readDocVersion } from '../storage/docs';
import type { Env } from '../types';
import { hashToken } from '../util/hash';
import { json } from '../api/json';

export async function handleShare(request: Request, env: Env, token: string): Promise<Response> {
  const tokenHash = await hashToken(token);
  const link = await env.DB.prepare(
    `SELECT * FROM share_links WHERE token_hash = ?`,
  )
    .bind(tokenHash)
    .first<{
      id: string;
      project_id: string;
      doc_id: string | null;
      expires_at: string;
      revoked_at: string | null;
    }>();

  if (!link || link.revoked_at) return json({ error: 'Not found' }, 404);
  if (new Date(link.expires_at).getTime() < Date.now()) {
    return json({ error: 'Link expired' }, 410);
  }

  const project = await env.DB.prepare(`SELECT id, name, slug FROM projects WHERE id = ?`)
    .bind(link.project_id)
    .first();

  if (link.doc_id) {
    const doc = await env.DB.prepare(
      `SELECT id, path, title, current_version FROM docs WHERE id = ? AND project_id = ?`,
    )
      .bind(link.doc_id, link.project_id)
      .first<{ id: string; path: string; title: string; current_version: number }>();
    if (!doc) return json({ error: 'Doc not found' }, 404);
    const content = await readDocVersion(env, link.project_id, doc.id, doc.current_version);
    return json({ project, doc, content, read_only: true });
  }

  const docs = await env.DB.prepare(
    `SELECT id, path, title, current_version, drift_status FROM docs WHERE project_id = ? ORDER BY path`,
  )
    .bind(link.project_id)
    .all();
  return json({ project, docs: docs.results ?? [], read_only: true });
}
