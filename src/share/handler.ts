import { readDocVersion } from '../storage/docs';
import type { Env } from '../types';
import { hashToken } from '../util/hash';
import { json } from '../api/json';

function wantsHtml(request: Request): boolean {
  const accept = (request.headers.get('Accept') || '').toLowerCase();
  if (accept.includes('application/json') && !accept.includes('text/html')) return false;
  // Browsers send text/html first
  if (accept.includes('text/html') || accept.includes('*/*') || accept === '') return true;
  return false;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sharePage(opts: {
  projectName: string;
  title: string;
  subtitle: string;
  bodyHtml: string;
}): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeHtml(opts.title)} · Driftless share</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml"/>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0; font-family: "DM Sans", system-ui, sans-serif;
      background: radial-gradient(900px 480px at 10% -10%, #152238, transparent 50%),
                  radial-gradient(700px 400px at 100% 0%, #10261f, transparent 45%), #0b0f14;
      color: #e7eef8; min-height: 100vh;
    }
    header {
      display: flex; align-items: center; gap: .75rem;
      padding: 1rem 1.5rem; border-bottom: 1px solid #243041;
      background: rgba(10,14,20,.85); backdrop-filter: blur(8px);
    }
    header img { width: 28px; height: 28px; border-radius: 7px; }
    header .brand { font-weight: 700; letter-spacing: -.03em; }
    .pill {
      margin-left: auto; font-size: .78rem; color: #8b9bb0;
      border: 1px solid #243041; border-radius: 999px; padding: .2rem .65rem;
    }
    main { max-width: 820px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
    h1 { margin: 0 0 .35rem; font-size: 1.85rem; letter-spacing: -.03em; }
    .sub { color: #8b9bb0; margin-bottom: 1.5rem; }
    .card {
      background: #121821; border: 1px solid #243041; border-radius: 12px;
      padding: 1.1rem 1.25rem; margin-bottom: 1rem;
    }
    .card h3 { margin: 0 0 .35rem; font-size: 1.05rem; }
    .path { font-family: ui-monospace, monospace; font-size: .8rem; color: #8b9bb0; }
    pre, .md {
      white-space: pre-wrap; word-break: break-word;
      font-family: ui-monospace, "JetBrains Mono", monospace;
      font-size: .9rem; line-height: 1.5; margin: 0;
    }
    a { color: #5b8cff; }
  </style>
</head>
<body>
  <header>
    <img src="/logo-mark.svg" alt=""/>
    <div class="brand">Driftless</div>
    <div class="pill">Read-only share · ${escapeHtml(opts.projectName)}</div>
  </header>
  <main>
    <h1>${escapeHtml(opts.title)}</h1>
    <p class="sub">${escapeHtml(opts.subtitle)}</p>
    ${opts.bodyHtml}
  </main>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export async function handleShare(request: Request, env: Env, token: string): Promise<Response> {
  const tokenHash = await hashToken(token);
  const link = await env.DB.prepare(`SELECT * FROM share_links WHERE token_hash = ?`)
    .bind(tokenHash)
    .first<{
      id: string;
      project_id: string;
      doc_id: string | null;
      expires_at: string;
      revoked_at: string | null;
    }>();

  if (!link || link.revoked_at) {
    if (wantsHtml(request)) {
      return sharePage({
        projectName: 'Driftless',
        title: 'Share not found',
        subtitle: 'This link is invalid or was revoked.',
        bodyHtml: '',
      });
    }
    return json({ error: 'Not found' }, 404);
  }
  if (new Date(link.expires_at).getTime() < Date.now()) {
    if (wantsHtml(request)) {
      return sharePage({
        projectName: 'Driftless',
        title: 'Link expired',
        subtitle: 'Ask the owner for a new share link.',
        bodyHtml: '',
      });
    }
    return json({ error: 'Link expired' }, 410);
  }

  const project = await env.DB.prepare(`SELECT id, name, slug FROM projects WHERE id = ?`)
    .bind(link.project_id)
    .first<{ id: string; name: string; slug: string }>();

  const projectName = project?.name || 'Project';

  if (link.doc_id) {
    const doc = await env.DB.prepare(
      `SELECT id, path, title, current_version FROM docs WHERE id = ? AND project_id = ?`,
    )
      .bind(link.doc_id, link.project_id)
      .first<{ id: string; path: string; title: string; current_version: number }>();
    if (!doc) return json({ error: 'Doc not found' }, 404);
    const content = await readDocVersion(env, link.project_id, doc.id, doc.current_version);
    if (wantsHtml(request)) {
      return sharePage({
        projectName,
        title: doc.title,
        subtitle: `${doc.path} · read-only preview`,
        bodyHtml: `<div class="card"><pre class="md">${escapeHtml(content || '')}</pre></div>`,
      });
    }
    return json({ project, doc, content, read_only: true });
  }

  const docs = await env.DB.prepare(
    `SELECT id, path, title, current_version, drift_status FROM docs WHERE project_id = ? ORDER BY path`,
  )
    .bind(link.project_id)
    .all<{ id: string; path: string; title: string; current_version: number; drift_status: string }>();

  const list = docs.results ?? [];
  if (wantsHtml(request)) {
    const cards = list
      .map(
        (d) =>
          `<div class="card"><h3>${escapeHtml(d.title)}</h3><div class="path">${escapeHtml(d.path)}</div></div>`,
      )
      .join('');
    return sharePage({
      projectName,
      title: projectName,
      subtitle: `${list.length} doc${list.length === 1 ? '' : 's'} · read-only share`,
      bodyHtml: cards || `<div class="card muted">No docs yet.</div>`,
    });
  }
  return json({ project, docs: list, read_only: true });
}
