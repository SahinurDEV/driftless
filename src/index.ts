import { handleApi } from './api/router';
import { isAuthError } from './auth/context';
import { error as apiError } from './api/json';
import { handleOAuthCallback, logout, startOAuth } from './auth/github';
import { handleMcp } from './mcp/server';
import { handleQueueBatch } from './queue/consumer';
import { handleShare } from './share/handler';
import type { Env, QueueMessage } from './types';
import { handleGitHubWebhook } from './webhook/github';

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/oauth/github' || path === '/oauth/github/login') {
        return await startOAuth(env, request, url.searchParams.get('redirect') ?? '/');
      }
      if (path === '/oauth/github/callback') {
        return await handleOAuthCallback(env, request);
      }
      if (path === '/oauth/logout') {
        return await logout(env, request);
      }
      if (path === '/webhook/github') {
        return await handleGitHubWebhook(request, env);
      }
      if (path === '/mcp' || path.startsWith('/mcp/')) {
        return await handleMcp(request, env);
      }
      const share = path.match(/^\/share\/([^/]+)\/?$/);
      if (share) {
        return await handleShare(request, env, share[1]);
      }
      if (path.startsWith('/api/')) {
        return await handleApi(request, env, path);
      }

      // Serve dashboard assets
      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }
      return new Response(
        `<!doctype html><html><head><meta charset="utf-8"><title>Driftless</title></head>
         <body style="font-family:system-ui;max-width:40rem;margin:3rem auto;padding:0 1rem">
         <h1>Driftless</h1>
         <p>API is running. Build the dashboard with <code>npm run build:dashboard</code>.</p>
         <p><a href="/api/health">/api/health</a> · <a href="/oauth/github">Login with GitHub</a></p>
         </body></html>`,
        { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
      );
    } catch (e) {
      if (isAuthError(e)) {
        return apiError(e.message, e.status);
      }
      console.error(e);
      return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },

  async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
    await handleQueueBatch(batch, env);
  },
};
