import type { AuthContext, Env } from '../types';
import { hashApiKey, hashToken } from '../util/hash';
import { nowIso } from '../util/time';

function parseCookie(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (!k) continue;
    out[k] = rest.join('=');
  }
  return out;
}

export async function resolveAuth(env: Env, request: Request): Promise<AuthContext | null> {
  const authHeader = request.headers.get('Authorization') ?? '';
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    const raw = authHeader.slice(7).trim();
    if (raw.startsWith('dl_')) {
      return resolveApiKey(env, raw);
    }
  }

  const cookie = parseCookie(request.headers.get('Cookie') ?? '');
  const sessionToken = cookie['driftless_session'];
  if (sessionToken) {
    return resolveSession(env, sessionToken);
  }
  return null;
}

async function resolveSession(env: Env, token: string): Promise<AuthContext | null> {
  const hash = await hashToken(token);
  const row = await env.DB.prepare(
    `SELECT s.user_id, s.expires_at, u.login
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?`,
  )
    .bind(hash)
    .first<{ user_id: string; expires_at: string; login: string }>();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return {
    userId: row.user_id,
    login: row.login,
    via: 'session',
    permission: 'session',
  };
}

async function resolveApiKey(env: Env, rawKey: string): Promise<AuthContext | null> {
  const keyHash = await hashApiKey(rawKey);
  const row = await env.DB.prepare(
    `SELECT k.id, k.user_id, k.permission, k.project_ids, k.revoked_at, u.login
     FROM api_keys k JOIN users u ON u.id = k.user_id
     WHERE k.key_hash = ?`,
  )
    .bind(keyHash)
    .first<{
      id: string;
      user_id: string;
      permission: 'read' | 'write';
      project_ids: string;
      revoked_at: string | null;
      login: string;
    }>();
  if (!row || row.revoked_at) return null;
  await env.DB.prepare(`UPDATE api_keys SET last_used_at = ? WHERE id = ?`)
    .bind(nowIso(), row.id)
    .run();
  let projectIds: string[] = [];
  try {
    projectIds = JSON.parse(row.project_ids) as string[];
  } catch {
    projectIds = [];
  }
  return {
    userId: row.user_id,
    login: row.login,
    via: 'api_key',
    apiKeyId: row.id,
    permission: row.permission,
    projectIds: projectIds.length ? projectIds : undefined,
  };
}

export async function requireAuth(env: Env, request: Request): Promise<AuthContext> {
  const auth = await resolveAuth(env, request);
  if (!auth) throw new AuthError('Unauthorized', 401);
  return auth;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

/** Check project role for session users; API keys must include project if scoped. */
export async function requireProjectAccess(
  env: Env,
  auth: AuthContext,
  projectId: string,
  minRole: 'viewer' | 'editor' | 'owner' = 'viewer',
): Promise<'owner' | 'editor' | 'viewer'> {
  if (auth.via === 'api_key' && auth.projectIds && !auth.projectIds.includes(projectId)) {
    throw new AuthError('API key not scoped to this project', 403);
  }

  const row = await env.DB.prepare(
    `SELECT role FROM project_members WHERE project_id = ? AND user_id = ?`,
  )
    .bind(projectId, auth.userId)
    .first<{ role: 'owner' | 'editor' | 'viewer' }>();

  if (!row) {
    // Fallback: workspace owner of project's workspace
    const ws = await env.DB.prepare(
      `SELECT wm.role FROM projects p
       JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
       WHERE p.id = ? AND wm.user_id = ?`,
    )
      .bind(projectId, auth.userId)
      .first<{ role: 'owner' | 'editor' | 'viewer' }>();
    if (!ws) throw new AuthError('Forbidden', 403);
    assertRole(ws.role, minRole);
    return ws.role;
  }
  assertRole(row.role, minRole);
  return row.role;
}

function assertRole(
  have: 'owner' | 'editor' | 'viewer',
  need: 'viewer' | 'editor' | 'owner',
): void {
  const rank = { viewer: 1, editor: 2, owner: 3 };
  if (rank[have] < rank[need]) throw new AuthError('Forbidden', 403);
}

// fix typo - I accidentally wrote "of 3"
