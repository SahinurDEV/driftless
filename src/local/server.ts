import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { existsSync } from 'node:fs';
import type { Env } from '../types/env';
import { handleApi } from '../api/router';
import { handleMcp } from '../mcp/server';
import { handleShare } from '../share/handler';
import { isAuthError } from '../auth/context';
import { error as apiError } from '../api/json';
import { createLocalSession, hashPassword, LOCAL_USER_ID } from './bootstrap';
import { loadWatchedRepos, startRepoWatcher } from './watcher';
import type { LocalConfig } from './config';
import { nowIso } from '../util/time';
import { newId } from '../util/id';
import { hashToken } from '../util/hash';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function toWebRequest(req: IncomingMessage, body: Buffer, host: string): Request {
  const url = `http://${host}${req.url || '/'}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v == null) continue;
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else headers.set(k, v);
  }
  const method = req.method || 'GET';
  const init: RequestInit = { method, headers };
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = body;
  }
  return new Request(url, init);
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}

async function sendWebResponse(res: ServerResponse, web: Response): Promise<void> {
  res.statusCode = web.status;
  web.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') {
      const existing = res.getHeader('Set-Cookie');
      if (!existing) res.setHeader('Set-Cookie', value);
      else if (Array.isArray(existing)) res.setHeader('Set-Cookie', [...existing, value]);
      else res.setHeader('Set-Cookie', [String(existing), value]);
    } else {
      res.setHeader(key, value);
    }
  });
  const buf = Buffer.from(await web.arrayBuffer());
  res.end(buf);
}

export async function startLocalServer(
  env: Env,
  cfg: LocalConfig,
  opts: { dashboardDir: string; openAuth?: boolean },
): Promise<{ close: () => Promise<void>; port: number }> {
  const dashboardDir = opts.dashboardDir;

  // Auto-session cookie helper for open local mode
  async function maybeAttachLocalSession(request: Request): Promise<Request> {
    if (!env.LOCAL_MODE) return request;
    if (env.LOCAL_PASSWORD_HASH) return request;
    const cookie = request.headers.get('Cookie') || '';
    if (cookie.includes('driftless_session=')) return request;
    // API key auth still works without session
    const auth = request.headers.get('Authorization');
    if (auth?.toLowerCase().startsWith('bearer dl_')) return request;

    const token = await createLocalSession(env);
    const headers = new Headers(request.headers);
    headers.set('Cookie', `driftless_session=${token}; Path=/; HttpOnly; SameSite=Lax`);
    // stash for Set-Cookie on response via WeakMap... we'll set on health/me
    (request as unknown as { __localSession?: string }).__localSession = token;
    return new Request(request, { headers });
  }

  const watched = await loadWatchedRepos(env);
  let watcher = startRepoWatcher(env, watched);

  async function refreshWatcher() {
    await watcher.close();
    const repos = await loadWatchedRepos(env);
    watcher = startRepoWatcher(env, repos);
  }

  // Poll for new repos every 5s (CLI/dashboard adds)
  const refreshTimer = setInterval(() => {
    void refreshWatcher().catch(() => {});
  }, 5000);

  const server = createServer(async (req, res) => {
    try {
      const host = req.headers.host || `127.0.0.1:${cfg.port}`;
      const body = await readBody(req);
      let request = toWebRequest(req, body, host);
      request = await maybeAttachLocalSession(request);
      const url = new URL(request.url);
      const path = url.pathname;

      // Local password login
      if (path === '/api/local/login' && request.method === 'POST') {
        const json = JSON.parse(body.toString('utf8') || '{}') as { password?: string };
        if (!env.LOCAL_PASSWORD_HASH) {
          await sendWebResponse(res, apiError('Password auth not enabled', 400));
          return;
        }
        if (!json.password || hashPassword(json.password) !== env.LOCAL_PASSWORD_HASH) {
          await sendWebResponse(res, apiError('Invalid password', 401));
          return;
        }
        const token = await createLocalSession(env);
        const web = new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': `driftless_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`,
          },
        });
        await sendWebResponse(res, web);
        return;
      }

      if (path === '/oauth/logout') {
        const web = new Response(null, {
          status: 302,
          headers: {
            Location: '/',
            'Set-Cookie': 'driftless_session=; Path=/; Max-Age=0',
          },
        });
        await sendWebResponse(res, web);
        return;
      }

      // Block GitHub OAuth in local mode
      if (path.startsWith('/oauth/github')) {
        await sendWebResponse(
          res,
          new Response('GitHub OAuth is disabled in local mode. Use the dashboard or API keys.', {
            status: 404,
          }),
        );
        return;
      }
      if (path === '/webhook/github') {
        await sendWebResponse(res, apiError('GitHub webhooks disabled in local mode', 404));
        return;
      }

      let web: Response;
      if (path === '/mcp' || path.startsWith('/mcp/')) {
        web = await handleMcp(request, env);
      } else if (path.match(/^\/share\/([^/]+)\/?$/)) {
        const m = path.match(/^\/share\/([^/]+)\/?$/)!;
        web = await handleShare(request, env, m[1]);
      } else if (path.startsWith('/api/')) {
        web = await handleApi(request, env, path);
        // After repo mutations, refresh watcher soon
        if (path.includes('/repos') && request.method === 'POST') {
          void refreshWatcher();
        }
      } else {
        web = await serveDashboard(dashboardDir, path);
      }

      // Attach auto session cookie if we minted one
      const minted = (request as unknown as { __localSession?: string }).__localSession;
      if (minted && !web.headers.get('Set-Cookie')) {
        const headers = new Headers(web.headers);
        headers.append(
          'Set-Cookie',
          `driftless_session=${minted}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`,
        );
        web = new Response(web.body, { status: web.status, statusText: web.statusText, headers });
      }

      await sendWebResponse(res, web);
    } catch (e) {
      if (isAuthError(e)) {
        await sendWebResponse(res, apiError(e.message, e.status));
        return;
      }
      console.error(e);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'error' }));
    }
  });

  await new Promise<void>((resolve) => server.listen(cfg.port, '127.0.0.1', () => resolve()));
  console.log(`Driftless local server on http://127.0.0.1:${cfg.port}`);
  console.log(`Data dir: ${cfg.dataDir}`);
  if (env.LOCAL_PASSWORD_HASH) console.log('Password auth enabled');
  else console.log('Open local auth (no password) — bound to localhost only');

  return {
    port: cfg.port,
    async close() {
      clearInterval(refreshTimer);
      await watcher.close();
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    },
  };
}

async function serveDashboard(dashboardDir: string, path: string): Promise<Response> {
  let rel = path === '/' ? '/index.html' : path;
  // SPA fallback
  let filePath = join(dashboardDir, rel);
  if (!existsSync(filePath) || rel.includes('..')) {
    filePath = join(dashboardDir, 'index.html');
    rel = '/index.html';
  }
  try {
    const data = await readFile(filePath);
    const type = MIME[extname(filePath)] || 'application/octet-stream';
    return new Response(data, { headers: { 'Content-Type': type } });
  } catch {
    return new Response('Dashboard not built. Run: npm run build:dashboard', { status: 503 });
  }
}

// silence unused in case tree-shake
void LOCAL_USER_ID;
void nowIso;
void newId;
void hashToken;
