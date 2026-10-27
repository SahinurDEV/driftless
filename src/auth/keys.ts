import type { ApiKeyPermission, Env } from '../types';
import { hashApiKey } from '../util/hash';
import { newId, newToken } from '../util/id';
import { nowIso } from '../util/time';

export async function createApiKey(
  env: Env,
  userId: string,
  name: string,
  permission: ApiKeyPermission,
  projectIds: string[] = [],
): Promise<{ id: string; key: string; prefix: string }> {
  const secret = newToken(24);
  const key = `dl_${secret}`;
  const prefix = key.slice(0, 10);
  const keyHash = await hashApiKey(key);
  const id = newId('key');
  await env.DB.prepare(
    `INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash, permission, project_ids, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, userId, name, prefix, keyHash, permission, JSON.stringify(projectIds), nowIso())
    .run();
  return { id, key, prefix };
}

export async function revokeApiKey(env: Env, userId: string, keyId: string): Promise<boolean> {
  const r = await env.DB.prepare(
    `UPDATE api_keys SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
  )
    .bind(nowIso(), keyId, userId)
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

export async function listApiKeys(env: Env, userId: string) {
  const rows = await env.DB.prepare(
    `SELECT id, name, key_prefix, permission, project_ids, last_used_at, revoked_at, created_at
     FROM api_keys WHERE user_id = ? ORDER BY created_at DESC`,
  )
    .bind(userId)
    .all();
  return rows.results ?? [];
}
