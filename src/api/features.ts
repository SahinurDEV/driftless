import type { Env, AuthContext } from '../types';
import { requireProjectAccess } from '../auth/context';
import { error, json, readJson } from './json';
import { newId } from '../util/id';
import { nowIso } from '../util/time';
import { listDocVersions, getVersionDiff, rollbackDoc } from '../storage/versions';
import { readDocVersion } from '../storage/docs';
import { generateDocFromRepo } from '../docs/generate';
import { sendWebhook, type WebhookType } from '../notify/webhooks';
import { parseJUnitXml, ingestTestFailures } from '../tests-ingest/junit';
import { indexRepoCode, searchAll, searchCode } from '../search/code-index';
import { saveDoc } from '../storage/docs';

/** Overview across all projects the user can see. */
export async function handleOverview(env: Env, auth: AuthContext): Promise<Response> {
  const projects = await env.DB.prepare(
    `SELECT p.id, p.name, p.slug, p.trust_mode, p.updated_at, p.workspace_id
     FROM projects p
     JOIN project_members pm ON pm.project_id = p.id
     WHERE pm.user_id = ?
     ORDER BY p.updated_at DESC`,
  )
    .bind(auth.userId)
    .all<{
      id: string;
      name: string;
      slug: string;
      trust_mode: string;
      updated_at: string;
      workspace_id: string;
    }>();

  const items = [];
  for (const p of projects.results ?? []) {
    const docs = await env.DB.prepare(
      `SELECT drift_status, COUNT(*) AS c FROM docs WHERE project_id = ? GROUP BY drift_status`,
    )
      .bind(p.id)
      .all<{ drift_status: string; c: number }>();
    const counts = { ok: 0, stale: 0, review: 0, total: 0 };
    for (const row of docs.results ?? []) {
      const n = Number(row.c);
      counts.total += n;
      if (row.drift_status === 'ok') counts.ok = n;
      else if (row.drift_status === 'stale') counts.stale = n;
      else if (row.drift_status === 'review') counts.review = n;
    }
    const flags = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM drift_flags WHERE project_id = ? AND status = 'open'`,
    )
      .bind(p.id)
      .first<{ c: number }>();
    const repos = await env.DB.prepare(
      `SELECT id, github_owner, github_name, local_path, updated_at FROM repos WHERE project_id = ?`,
    )
      .bind(p.id)
      .all();
    const lastDoc = await env.DB.prepare(
      `SELECT MAX(updated_at) AS t FROM docs WHERE project_id = ?`,
    )
      .bind(p.id)
      .first<{ t: string | null }>();
    items.push({
      ...p,
      docs: counts,
      open_flags: Number(flags?.c ?? 0),
      repos: repos.results ?? [],
      last_activity: lastDoc?.t || p.updated_at,
    });
  }
  return json({ projects: items });
}

export async function handleFeatureProjectRoutes(
  request: Request,
  env: Env,
  auth: AuthContext,
  projectId: string,
  rest: string,
): Promise<Response | null> {
  // Generate doc from repo
  if (rest === '/docs/generate' && request.method === 'POST') {
    await requireProjectAccess(env, auth, projectId, 'editor');
    if (auth.permission === 'read') return error('Read-only key', 403);
    if (!env.LOCAL_MODE) return error('Doc generate from folder requires local mode', 400);
    const body = await readJson<{ repo_id?: string; local_path?: string; use_ollama?: boolean }>(
      request,
    );
    let localPath = body.local_path;
    let repoId = body.repo_id ?? null;
    if (!localPath && repoId) {
      const r = await env.DB.prepare(`SELECT local_path FROM repos WHERE id = ? AND project_id = ?`)
        .bind(repoId, projectId)
        .first<{ local_path: string | null }>();
      localPath = r?.local_path ?? undefined;
    }
    if (!localPath) {
      const first = await env.DB.prepare(
        `SELECT id, local_path FROM repos WHERE project_id = ? AND local_path IS NOT NULL LIMIT 1`,
      )
        .bind(projectId)
        .first<{ id: string; local_path: string }>();
      if (first) {
        localPath = first.local_path;
        repoId = first.id;
      }
    }
    if (!localPath) return error('local_path or repo_id with local_path required', 400);
    const generated = await generateDocFromRepo(localPath, { useOllama: body.use_ollama });
    const docId = newId('doc');
    const result = await saveDoc(env, {
      projectId,
      docId,
      path: generated.path,
      content: generated.content,
      baseVersion: null,
      authorId: auth.userId,
      authorType: 'system',
      summary: 'Generated from code',
      repoId,
    });
    if (!result.ok) {
      // update existing path
      const existing = await env.DB.prepare(
        `SELECT id, current_version FROM docs WHERE project_id = ? AND path = ?`,
      )
        .bind(projectId, generated.path)
        .first<{ id: string; current_version: number }>();
      if (existing) {
        const upd = await saveDoc(env, {
          projectId,
          docId: existing.id,
          path: generated.path,
          content: generated.content,
          baseVersion: existing.current_version,
          authorId: auth.userId,
          authorType: 'system',
          summary: 'Regenerated from code',
          repoId,
        });
        if (!upd.ok) return error(upd.error, 409);
        return json({ id: existing.id, ...upd, regenerated: true });
      }
      return error(result.error, 409);
    }
    return json({ id: docId, ...result, path: generated.path }, 201);
  }

  // Notifications settings
  if (rest === '/notifications' && request.method === 'GET') {
    await requireProjectAccess(env, auth, projectId, 'viewer');
    const row = await env.DB.prepare(
      `SELECT notify_webhook_url, notify_webhook_type FROM projects WHERE id = ?`,
    )
      .bind(projectId)
      .first<{ notify_webhook_url: string | null; notify_webhook_type: string | null }>();
    return json({
      webhook_url: row?.notify_webhook_url ?? '',
      webhook_type: row?.notify_webhook_type ?? 'slack',
    });
  }

  if (rest === '/notifications' && request.method === 'PUT') {
    await requireProjectAccess(env, auth, projectId, 'owner');
    const body = await readJson<{ webhook_url?: string; webhook_type?: WebhookType }>(request);
    await env.DB.prepare(
      `UPDATE projects SET notify_webhook_url = ?, notify_webhook_type = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(body.webhook_url ?? null, body.webhook_type ?? 'slack', nowIso(), projectId)
      .run();
    return json({ ok: true });
  }

  if (rest === '/notifications/test' && request.method === 'POST') {
    await requireProjectAccess(env, auth, projectId, 'editor');
    const row = await env.DB.prepare(
      `SELECT name, notify_webhook_url, notify_webhook_type FROM projects WHERE id = ?`,
    )
      .bind(projectId)
      .first<{ name: string; notify_webhook_url: string | null; notify_webhook_type: string | null }>();
    if (!row?.notify_webhook_url) return error('Configure a webhook URL first', 400);
    const base = env.APP_BASE_URL || (env.LOCAL_MODE ? 'http://127.0.0.1:4747' : '');
    const result = await sendWebhook(
      row.notify_webhook_url,
      (row.notify_webhook_type as WebhookType) || 'slack',
      {
        projectId,
        projectName: row.name,
        flagId: 'test',
        docTitle: 'Test notification',
        docPath: 'test.md',
        reason: 'This is a Driftless test alert',
        matchType: 'manual',
        dashboardUrl: base ? `${base}/projects/${projectId}/drift` : undefined,
      },
    );
    return json(result, result.ok ? 200 : 502);
  }

  // Team members (local names)
  if (rest === '/team' && request.method === 'GET') {
    await requireProjectAccess(env, auth, projectId, 'viewer');
    const rows = await env.DB.prepare(
      `SELECT id, name, created_at FROM local_team WHERE project_id = ? ORDER BY name`,
    )
      .bind(projectId)
      .all();
    return json({ team: rows.results ?? [] });
  }

  if (rest === '/team' && request.method === 'POST') {
    await requireProjectAccess(env, auth, projectId, 'editor');
    const body = await readJson<{ name: string }>(request);
    if (!body.name?.trim()) return error('name required');
    const id = newId('tm');
    await env.DB.prepare(
      `INSERT INTO local_team (id, project_id, name, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(project_id, name) DO NOTHING`,
    )
      .bind(id, projectId, body.name.trim(), nowIso())
      .run();
    return json({ id, name: body.name.trim() }, 201);
  }

  // Drift assign / comments — handled via /drift/:id/...
  const driftAssign = rest.match(/^\/drift\/([^/]+)\/assign$/);
  if (driftAssign && request.method === 'POST') {
    await requireProjectAccess(env, auth, projectId, 'editor');
    const body = await readJson<{ assignee?: string; assignee_name?: string }>(request);
    await env.DB.prepare(
      `UPDATE drift_flags SET assignee = ?, assignee_name = ? WHERE id = ? AND project_id = ?`,
    )
      .bind(body.assignee ?? null, body.assignee_name ?? body.assignee ?? null, driftAssign[1], projectId)
      .run();
    return json({ ok: true });
  }

  const driftComments = rest.match(/^\/drift\/([^/]+)\/comments$/);
  if (driftComments && request.method === 'GET') {
    await requireProjectAccess(env, auth, projectId, 'viewer');
    const rows = await env.DB.prepare(
      `SELECT id, author_id, author_name, body, created_at FROM drift_comments
       WHERE flag_id = ? AND project_id = ? ORDER BY created_at`,
    )
      .bind(driftComments[1], projectId)
      .all();
    return json({ comments: rows.results ?? [] });
  }

  if (driftComments && request.method === 'POST') {
    await requireProjectAccess(env, auth, projectId, 'editor');
    const body = await readJson<{ body: string; author_name?: string }>(request);
    if (!body.body?.trim()) return error('body required');
    const user = await env.DB.prepare(`SELECT login, name FROM users WHERE id = ?`)
      .bind(auth.userId)
      .first<{ login: string; name: string | null }>();
    const id = newId('drc');
    const authorName = body.author_name || user?.name || user?.login || 'local';
    await env.DB.prepare(
      `INSERT INTO drift_comments (id, flag_id, project_id, author_id, author_name, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, driftComments[1], projectId, auth.userId, authorName, body.body.trim(), nowIso())
      .run();
    return json({ id }, 201);
  }

  // Filtered drift list with assignee
  if (rest === '/drift' && request.method === 'GET') {
    // let main router handle if no assignee filter — return null to fall through
    // Actually we enhance: if this is called from features first, handle with filter
    return null;
  }

  // Unified search
  if (rest === '/search' && request.method === 'GET') {
    await requireProjectAccess(env, auth, projectId, 'viewer');
    const url = new URL(request.url);
    const q = url.searchParams.get('q') || '';
    const scope = url.searchParams.get('scope') || 'all'; // all | docs | code
    if (scope === 'code') {
      return json({ docs: [], code: await searchCode(env, projectId, q) });
    }
    if (scope === 'docs') {
      const { searchDocs } = await import('../storage/docs');
      return json({ docs: await searchDocs(env, projectId, q), code: [] });
    }
    return json(await searchAll(env, projectId, q));
  }

  // Reindex code
  if (rest === '/code/reindex' && request.method === 'POST') {
    await requireProjectAccess(env, auth, projectId, 'editor');
    if (!env.LOCAL_MODE) return error('Code index requires local mode', 400);
    const repos = await env.DB.prepare(
      `SELECT id, local_path FROM repos WHERE project_id = ? AND local_path IS NOT NULL`,
    )
      .bind(projectId)
      .all<{ id: string; local_path: string }>();
    let total = 0;
    for (const r of repos.results ?? []) {
      const res = await indexRepoCode(env, {
        projectId,
        repoId: r.id,
        localPath: r.local_path,
      });
      total += res.indexed;
    }
    return json({ indexed: total, repos: (repos.results ?? []).length });
  }

  return null;
}

export async function handleFeatureDocRoutes(
  request: Request,
  env: Env,
  auth: AuthContext,
  projectId: string,
  docId: string,
  rest: string,
  meta: { id: string; path: string; current_version: number },
): Promise<Response | null> {
  if (rest === '/versions' && request.method === 'GET') {
    await requireProjectAccess(env, auth, projectId, 'viewer');
    const versions = await listDocVersions(env, docId);
    return json({ versions, current: meta.current_version });
  }

  const verMatch = rest.match(/^\/versions\/(\d+)$/);
  if (verMatch && request.method === 'GET') {
    await requireProjectAccess(env, auth, projectId, 'viewer');
    const v = Number(verMatch[1]);
    const content = await readDocVersion(env, projectId, docId, v);
    if (content == null) return error('Version not found', 404);
    return json({ version: v, content });
  }

  if (rest === '/diff' && request.method === 'GET') {
    await requireProjectAccess(env, auth, projectId, 'viewer');
    const url = new URL(request.url);
    const from = Number(url.searchParams.get('from') || meta.current_version - 1);
    const to = Number(url.searchParams.get('to') || meta.current_version);
    const diff = await getVersionDiff(env, projectId, docId, from, to);
    if (!diff) return error('Version not found', 404);
    return json(diff);
  }

  if (rest === '/rollback' && request.method === 'POST') {
    await requireProjectAccess(env, auth, projectId, 'editor');
    if (auth.permission === 'read') return error('Read-only key', 403);
    const body = await readJson<{ to_version: number }>(request);
    if (!body.to_version) return error('to_version required');
    const result = await rollbackDoc(env, {
      projectId,
      docId,
      path: meta.path,
      toVersion: body.to_version,
      currentVersion: meta.current_version,
      authorId: auth.userId,
    });
    if (!result.ok) return error(result.error, 409);
    return json(result);
  }

  return null;
}

export async function handleTestResults(
  request: Request,
  env: Env,
  auth: AuthContext,
): Promise<Response> {
  if (!env.LOCAL_MODE) return error('Test ingest is local-mode only', 400);
  const ct = request.headers.get('content-type') || '';
  let xml = '';
  let projectId = '';
  let repoId: string | undefined;
  if (ct.includes('application/json')) {
    const body = await readJson<{
      project_id: string;
      repo_id?: string;
      xml?: string;
      junit?: string;
    }>(request);
    projectId = body.project_id;
    repoId = body.repo_id;
    xml = body.xml || body.junit || '';
  } else {
    const url = new URL(request.url);
    projectId = url.searchParams.get('project_id') || '';
    repoId = url.searchParams.get('repo_id') || undefined;
    xml = await request.text();
  }
  if (!projectId) return error('project_id required');
  if (!xml.trim()) return error('JUnit XML body required');
  await requireProjectAccess(env, auth, projectId, 'editor');
  const failures = parseJUnitXml(xml);
  const result = await ingestTestFailures(env, {
    projectId,
    repoId,
    failures,
    commitSha: `test-${Date.now()}`,
  });
  return json({ failures: failures.length, ...result });
}
