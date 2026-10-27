import type { Env } from '../types';
import { hashToken } from '../util/hash';
import { newId, newToken } from '../util/id';
import { addSecondsIso, nowIso } from '../util/time';

const GITHUB_AUTHORIZE = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN = 'https://github.com/login/oauth/access_token';
const GITHUB_USER = 'https://api.github.com/user';

export function baseUrl(env: Env, request: Request): string {
  if (env.APP_BASE_URL) return env.APP_BASE_URL.replace(/\/$/, '');
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export async function startOAuth(
  env: Env,
  request: Request,
  redirectTo?: string,
): Promise<Response> {
  if (!env.GITHUB_CLIENT_ID) {
    return json({ error: 'GitHub OAuth is not configured (GITHUB_CLIENT_ID)' }, 503);
  }
  const state = newToken(16);
  const expires = addSecondsIso(600);
  await env.DB.prepare(
    `INSERT INTO oauth_states (state, redirect_to, created_at, expires_at) VALUES (?, ?, ?, ?)`,
  )
    .bind(state, redirectTo ?? '/', nowIso(), expires)
    .run();

  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: `${baseUrl(env, request)}/oauth/github/callback`,
    scope: 'read:user user:email',
    state,
  });
  return Response.redirect(`${GITHUB_AUTHORIZE}?${params}`, 302);
}

export async function handleOAuthCallback(env: Env, request: Request): Promise<Response> {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !env.SESSION_SECRET) {
    return json({ error: 'GitHub OAuth is not configured' }, 503);
  }
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) return json({ error: 'Missing code/state' }, 400);

  const st = await env.DB.prepare(
    `SELECT state, redirect_to, expires_at FROM oauth_states WHERE state = ?`,
  )
    .bind(state)
    .first<{ state: string; redirect_to: string | null; expires_at: string }>();
  await env.DB.prepare(`DELETE FROM oauth_states WHERE state = ?`).bind(state).run();
  if (!st || new Date(st.expires_at).getTime() < Date.now()) {
    return json({ error: 'Invalid or expired state' }, 400);
  }

  const tokenRes = await fetch(GITHUB_TOKEN, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'driftless',
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${baseUrl(env, request)}/oauth/github/callback`,
    }),
  });
  const tokenBody = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!tokenBody.access_token) {
    return json({ error: tokenBody.error ?? 'OAuth token exchange failed' }, 400);
  }

  const userRes = await fetch(GITHUB_USER, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${tokenBody.access_token}`,
      'User-Agent': 'driftless',
    },
  });
  if (!userRes.ok) return json({ error: 'Failed to fetch GitHub user' }, 502);
  const gh = (await userRes.json()) as {
    id: number;
    login: string;
    name?: string;
    email?: string;
    avatar_url?: string;
  };

  const githubId = String(gh.id);
  let user = await env.DB.prepare(`SELECT id FROM users WHERE github_id = ?`)
    .bind(githubId)
    .first<{ id: string }>();

  const ts = nowIso();
  if (!user) {
    const id = newId('usr');
    await env.DB.prepare(
      `INSERT INTO users (id, github_id, login, name, email, avatar_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, githubId, gh.login, gh.name ?? null, gh.email ?? null, gh.avatar_url ?? null, ts, ts)
      .run();
    user = { id };
  } else {
    await env.DB.prepare(
      `UPDATE users SET login = ?, name = ?, email = ?, avatar_url = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(gh.login, gh.name ?? null, gh.email ?? null, gh.avatar_url ?? null, ts, user.id)
      .run();
  }

  const sessionToken = newToken(32);
  const sessionId = newId('ses');
  const tokenHash = await hashToken(sessionToken);
  const expiresAt = addSecondsIso(60 * 60 * 24 * 30);
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(sessionId, user.id, tokenHash, expiresAt, ts)
    .run();

  const redirect = st.redirect_to || '/';
  const res = Response.redirect(`${baseUrl(env, request)}${redirect.startsWith('/') ? redirect : '/'}`, 302);
  const headers = new Headers(res.headers);
  headers.append(
    'Set-Cookie',
    `driftless_session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`,
  );
  return new Response(null, { status: 302, headers });
}

export async function logout(env: Env, request: Request): Promise<Response> {
  const cookie = parseCookie(request.headers.get('Cookie') ?? '');
  const token = cookie['driftless_session'];
  if (token) {
    const hash = await hashToken(token);
    await env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(hash).run();
  }
  const headers = new Headers({
    'Set-Cookie': 'driftless_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
    Location: '/',
  });
  return new Response(null, { status: 302, headers });
}

function parseCookie(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (!k) continue;
    out[k] = rest.join('=');
  }
  return out;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
