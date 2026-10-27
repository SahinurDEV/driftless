import type { Env } from '../types';
import { newId } from '../util/id';
import { nowIso } from '../util/time';

/** Ensure the user has at least one workspace; return its id. */
export async function ensureDefaultWorkspace(env: Env, userId: string): Promise<string> {
  const existing = await env.DB.prepare(
    `SELECT workspace_id FROM workspace_members WHERE user_id = ? ORDER BY created_at LIMIT 1`,
  )
    .bind(userId)
    .first<{ workspace_id: string }>();
  if (existing) return existing.workspace_id;

  const id = newId('ws');
  const ts = nowIso();
  const slugBase = 'workspace';
  let slug = slugBase;
  // Avoid global slug collisions
  for (let i = 0; i < 5; i++) {
    const clash = await env.DB.prepare(`SELECT id FROM workspaces WHERE slug = ?`)
      .bind(slug)
      .first();
    if (!clash) break;
    slug = `${slugBase}-${newId('').slice(0, 6)}`;
  }
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO workspaces (id, name, slug, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(id, 'My workspace', slug, userId, ts, ts),
    env.DB.prepare(
      `INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)`,
    ).bind(id, userId, ts),
  ]);
  return id;
}
