import type { Env } from '../types';
import { readDocVersion, saveDoc } from './docs';
import { unifiedDiff } from '../util/diff';

export async function listDocVersions(env: Env, docId: string) {
  const rows = await env.DB.prepare(
    `SELECT id, version, author_id, author_type, summary, content_hash, created_at, r2_key
     FROM doc_versions WHERE doc_id = ? ORDER BY version DESC`,
  )
    .bind(docId)
    .all();
  return rows.results ?? [];
}

export async function getVersionDiff(
  env: Env,
  projectId: string,
  docId: string,
  fromVersion: number,
  toVersion: number,
): Promise<{ from: number; to: number; diff: string; fromContent: string; toContent: string } | null> {
  const a = await readDocVersion(env, projectId, docId, fromVersion);
  const b = await readDocVersion(env, projectId, docId, toVersion);
  if (a == null || b == null) return null;
  return {
    from: fromVersion,
    to: toVersion,
    fromContent: a,
    toContent: b,
    diff: unifiedDiff(a, b, `v${fromVersion}`, `v${toVersion}`),
  };
}

export async function rollbackDoc(
  env: Env,
  opts: {
    projectId: string;
    docId: string;
    path: string;
    toVersion: number;
    currentVersion: number;
    authorId: string | null;
  },
): Promise<{ ok: true; version: number } | { ok: false; error: string }> {
  const content = await readDocVersion(env, opts.projectId, opts.docId, opts.toVersion);
  if (content == null) return { ok: false, error: 'version_not_found' };
  const saved = await saveDoc(env, {
    projectId: opts.projectId,
    docId: opts.docId,
    path: opts.path,
    content,
    baseVersion: opts.currentVersion,
    authorId: opts.authorId,
    authorType: 'user',
    summary: `Rollback to v${opts.toVersion}`,
  });
  if (!saved.ok) return { ok: false, error: saved.error };
  return { ok: true, version: saved.version };
}
