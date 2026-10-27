import { AuthError, expandApiKeyScope, isAuthError, requireAuth, requireProjectAccess, resolveAuth } from '../auth/context';
import { createApiKey, listApiKeys, revokeApiKey } from '../auth/keys';
import {
  exportProjectMarkdown,
  readDocVersion,
  saveDoc,
  searchDocs,
} from '../storage/docs';
import type { Env, TrustMode } from '../types';
import { applySectionPatch, outlineFromSections, parseFrontmatter, splitSections } from '../util/markdown';
import { newId, newToken } from '../util/id';
import { hashToken } from '../util/hash';
import { addSecondsIso, nowIso } from '../util/time';
import { decideEdit, estimateChangeSize, isSmallSafeFix } from '../trust/modes';
import { error, json, readJson } from './json';
import { ensureDefaultWorkspace } from '../auth/workspace';

export async function handleApi(request: Request, env: Env, path: string): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return json({ ok: true });
  }

  try {
    // Public health
    if (path === '/api/health' && request.method === 'GET') {
      return json({ ok: true, name: env.APP_NAME ?? 'Driftless', version: '0.1.0' });
    }

    // Me
    if (path === '/api/me' && request.method === 'GET') {
      const auth = await resolveAuth(env, request);
      if (!auth) return json({ user: null });
      const user = await env.DB.prepare(
        `SELECT id, login, name, email, avatar_url FROM users WHERE id = ?`,
      )
        .bind(auth.userId)
        .first();
      if (user && auth.via === 'session') {
        await ensureDefaultWorkspace(env, auth.userId);
      }
      return json({ user, auth: { via: auth.via, permission: auth.permission } });
    }

    // Everything below requires auth
    const auth = await requireAuth(env, request);

    // Workspaces
    if (path === '/api/workspaces' && request.method === 'GET') {
      const rows = await env.DB.prepare(
        `SELECT w.*, wm.role FROM workspaces w
         JOIN workspace_members wm ON wm.workspace_id = w.id
         WHERE wm.user_id = ? ORDER BY w.name`,
      )
        .bind(auth.userId)
        .all();
      return json({ workspaces: rows.results ?? [] });
    }

    if (path === '/api/workspaces' && request.method === 'POST') {
      if (auth.permission === 'read') return error('Read-only key', 403);
      const body = await readJson<{ name: string; slug?: string }>(request);
      if (!body.name?.trim()) return error('name required');
      const id = newId('ws');
      const slug =
        body.slug?.trim() ||
        body.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
      const ts = nowIso();
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO workspaces (id, name, slug, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(id, body.name.trim(), slug, auth.userId, ts, ts),
        env.DB.prepare(
          `INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)`,
        ).bind(id, auth.userId, ts),
      ]);
      return json({ id, name: body.name.trim(), slug }, 201);
    }

    // Projects
    if (path === '/api/workspaces/' && false) {
      /* placeholder */
    }

    const wsProjects = path.match(/^\/api\/workspaces\/([^/]+)\/projects$/);
    if (wsProjects && request.method === 'GET') {
      const workspaceId = wsProjects[1];
      const rows = await env.DB.prepare(
        `SELECT p.* FROM projects p
         JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
         WHERE p.workspace_id = ? AND wm.user_id = ?
         ORDER BY p.name`,
      )
        .bind(workspaceId, auth.userId)
        .all();
      return json({ projects: rows.results ?? [] });
    }

    if (wsProjects && request.method === 'POST') {
      if (auth.permission === 'read') return error('Read-only key', 403);
      const workspaceId = wsProjects[1];
      const mem = await env.DB.prepare(
        `SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?`,
      )
        .bind(workspaceId, auth.userId)
        .first<{ role: string }>();
      if (!mem || mem.role === 'viewer') return error('Forbidden', 403);
      const body = await readJson<{
        name: string;
        slug?: string;
        description?: string;
        trust_mode?: TrustMode;
      }>(request);
      if (!body.name?.trim()) return error('name required');
      const id = newId('prj');
      const slug =
        body.slug?.trim() ||
        body.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
      const trust = body.trust_mode ?? 'review';
      const ts = nowIso();
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO projects (id, workspace_id, name, slug, description, trust_mode, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(id, workspaceId, body.name.trim(), slug, body.description ?? null, trust, ts, ts),
        env.DB.prepare(
          `INSERT INTO project_members (project_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)`,
        ).bind(id, auth.userId, ts),
      ]);
      await expandApiKeyScope(env, auth, id);
      return json({ id, name: body.name.trim(), slug, trust_mode: trust }, 201);
    }

    // Convenience: create project (auto-creates default workspace if needed)
    if (path === '/api/projects' && request.method === 'POST') {
      if (auth.permission === 'read') return error('Read-only key', 403);
      const body = await readJson<{
        name: string;
        slug?: string;
        description?: string;
        trust_mode?: TrustMode;
        workspace_id?: string;
      }>(request);
      if (!body.name?.trim()) return error('name required');
      const workspaceId = body.workspace_id || (await ensureDefaultWorkspace(env, auth.userId));
      const mem = await env.DB.prepare(
        `SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?`,
      )
        .bind(workspaceId, auth.userId)
        .first<{ role: string }>();
      if (!mem || mem.role === 'viewer') return error('Forbidden', 403);
      const id = newId('prj');
      const slug =
        body.slug?.trim() ||
        body.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') ||
        id.slice(0, 8);
      // Ensure unique slug within workspace
      let finalSlug = slug;
      for (let i = 0; i < 6; i++) {
        const clash = await env.DB.prepare(
          `SELECT id FROM projects WHERE workspace_id = ? AND slug = ?`,
        )
          .bind(workspaceId, finalSlug)
          .first();
        if (!clash) break;
        finalSlug = `${slug}-${i + 2}`;
      }
      const trust = body.trust_mode ?? 'review';
      const ts = nowIso();
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO projects (id, workspace_id, name, slug, description, trust_mode, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(id, workspaceId, body.name.trim(), finalSlug, body.description ?? null, trust, ts, ts),
        env.DB.prepare(
          `INSERT INTO project_members (project_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)`,
        ).bind(id, auth.userId, ts),
      ]);
      await expandApiKeyScope(env, auth, id);
      return json({ id, name: body.name.trim(), slug: finalSlug, trust_mode: trust, workspace_id: workspaceId }, 201);
    }

    if (path === '/api/projects' && request.method === 'GET') {
      const rows = await env.DB.prepare(
        `SELECT DISTINCT p.*, pm.role AS my_role FROM projects p
         LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
         LEFT JOIN workspace_members wm ON wm.workspace_id = p.workspace_id AND wm.user_id = ?
         WHERE pm.user_id IS NOT NULL OR wm.user_id IS NOT NULL
         ORDER BY p.name`,
      )
        .bind(auth.userId, auth.userId)
        .all();
      return json({ projects: rows.results ?? [] });
    }

    const projectMatch = path.match(/^\/api\/projects\/([^/]+)(.*)$/);
    if (projectMatch) {
      return handleProjectRoutes(request, env, auth, projectMatch[1], projectMatch[2] || '');
    }

    // API keys
    if (path === '/api/keys' && request.method === 'GET') {
      return json({ keys: await listApiKeys(env, auth.userId) });
    }
    if (path === '/api/keys' && request.method === 'POST') {
      if (auth.via === 'api_key') return error('Cannot create keys with an API key', 403);
      const body = await readJson<{
        name: string;
        permission?: 'read' | 'write';
        project_ids?: string[];
      }>(request);
      if (!body.name?.trim()) return error('name required');
      const created = await createApiKey(
        env,
        auth.userId,
        body.name.trim(),
        body.permission ?? 'read',
        body.project_ids ?? [],
      );
      return json({ ...created, warning: 'Copy the key now; it will not be shown again' }, 201);
    }
    const keyMatch = path.match(/^\/api\/keys\/([^/]+)$/);
    if (keyMatch && request.method === 'DELETE') {
      const ok = await revokeApiKey(env, auth.userId, keyMatch[1]);
      return ok ? json({ ok: true }) : error('Not found', 404);
    }

    return error('Not found', 404);
  } catch (e) {
    const status = Number((e as { status?: unknown })?.status);
    if (status === 401 || status === 403) {
      return error(e instanceof Error ? e.message : 'Forbidden', status);
    }
    if (isAuthError(e)) return error(e.message, e.status);
    console.error(e);
    return error(e instanceof Error ? e.message : 'Internal error', 500);
  }
}

async function handleProjectRoutes(
  request: Request,
  env: Env,
  auth: Awaited<ReturnType<typeof requireAuth>>,
  projectId: string,
  rest: string,
): Promise<Response> {
  if (rest === '' && request.method === 'GET') {
    await requireProjectAccess(env, auth, projectId, 'viewer');
    const project = await env.DB.prepare(`SELECT * FROM projects WHERE id = ?`)
      .bind(projectId)
      .first();
    if (!project) return error('Not found', 404);
    const repos = await env.DB.prepare(`SELECT * FROM repos WHERE project_id = ? ORDER BY github_name`)
      .bind(projectId)
      .all();
    return json({ project, repos: repos.results ?? [] });
  }

  if (rest === '' && request.method === 'PATCH') {
    await requireProjectAccess(env, auth, projectId, 'owner');
    if (auth.permission === 'read') return error('Read-only key', 403);
    const body = await readJson<{
      name?: string;
      description?: string;
      trust_mode?: TrustMode;
      embeddings_enabled?: boolean;
      graft_enabled?: boolean;
    }>(request);
    const cur = await env.DB.prepare(`SELECT * FROM projects WHERE id = ?`)
      .bind(projectId)
      .first<Record<string, unknown>>();
    if (!cur) return error('Not found', 404);
    await env.DB.prepare(
      `UPDATE projects SET name = ?, description = ?, trust_mode = ?, embeddings_enabled = ?, graft_enabled = ?, updated_at = ?
       WHERE id = ?`,
    )
      .bind(
        body.name ?? cur.name,
        body.description !== undefined ? body.description : cur.description,
        body.trust_mode ?? cur.trust_mode,
        body.embeddings_enabled !== undefined
          ? body.embeddings_enabled
            ? 1
            : 0
          : cur.embeddings_enabled,
        body.graft_enabled !== undefined ? (body.graft_enabled ? 1 : 0) : cur.graft_enabled,
        nowIso(),
        projectId,
      )
      .run();
    return json({ ok: true });
  }

  // Repos
  if (rest === '/repos' && request.method === 'POST') {
    await requireProjectAccess(env, auth, projectId, 'editor');
    if (auth.permission === 'read') return error('Read-only key', 403);
    const body = await readJson<{
      github_owner: string;
      github_name: string;
      default_branch?: string;
    }>(request);
    if (!body.github_owner || !body.github_name) return error('github_owner and github_name required');
    const id = newId('repo');
    await env.DB.prepare(
      `INSERT INTO repos (id, project_id, github_owner, github_name, default_branch, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        projectId,
        body.github_owner,
        body.github_name,
        body.default_branch ?? 'main',
        nowIso(),
        nowIso(),
      )
      .run();
    return json({ id }, 201);
  }

  // Docs list / create
  if (rest === '/docs' && request.method === 'GET') {
    await requireProjectAccess(env, auth, projectId, 'viewer');
    const url = new URL(request.url);
    const q = url.searchParams.get('q');
    if (q) {
      const hits = await searchDocs(env, projectId, q);
      return json({ results: hits });
    }
    const docs = await env.DB.prepare(
      `SELECT id, path, title, current_version, drift_status, repo_id, updated_at FROM docs WHERE project_id = ? ORDER BY path`,
    )
      .bind(projectId)
      .all();
    return json({ docs: docs.results ?? [] });
  }

  if (rest === '/docs' && request.method === 'POST') {
    await requireProjectAccess(env, auth, projectId, 'editor');
    if (auth.permission === 'read') return error('Read-only key', 403);
    const body = await readJson<{ path: string; content: string; repo_id?: string }>(request);
    if (!body.path || body.content == null) return error('path and content required');
    const docId = newId('doc');
    const result = await saveDoc(env, {
      projectId,
      docId,
      path: body.path,
      content: body.content,
      baseVersion: null,
      authorId: auth.userId,
      authorType: auth.via === 'api_key' ? 'agent' : 'user',
      repoId: body.repo_id ?? null,
    });
    if (!result.ok) return error(result.error, 409);
    return json({ id: docId, ...result }, 201);
  }

  const docMatch = rest.match(/^\/docs\/([^/]+)(.*)$/);
  if (docMatch) {
    return handleDocRoutes(request, env, auth, projectId, docMatch[1], docMatch[2] || '');
  }

  // Drift
  if (rest === '/drift' && request.method === 'GET') {
    await requireProjectAccess(env, auth, projectId, 'viewer');
    const flags = await env.DB.prepare(
      `SELECT f.*, d.path AS doc_path, d.title AS doc_title
       FROM drift_flags f JOIN docs d ON d.id = f.doc_id
       WHERE f.project_id = ? AND f.status = 'open'
       ORDER BY f.created_at DESC`,
    )
      .bind(projectId)
      .all();
    return json({ flags: flags.results ?? [] });
  }

  const driftDismiss = rest.match(/^\/drift\/([^/]+)\/dismiss$/);
  if (driftDismiss && request.method === 'POST') {
    await requireProjectAccess(env, auth, projectId, 'editor');
    if (auth.permission === 'read') return error('Read-only key', 403);
    await env.DB.prepare(
      `UPDATE drift_flags SET status = 'dismissed', resolved_at = ?, resolved_by = ? WHERE id = ? AND project_id = ?`,
    )
      .bind(nowIso(), auth.userId, driftDismiss[1], projectId)
      .run();
    return json({ ok: true });
  }

  // Review queue
  if (rest === '/review' && request.method === 'GET') {
    await requireProjectAccess(env, auth, projectId, 'viewer');
    const items = await env.DB.prepare(
      `SELECT r.*, d.path AS doc_path, d.title AS doc_title
       FROM review_items r JOIN docs d ON d.id = r.doc_id
       WHERE r.project_id = ? AND r.status = 'pending'
       ORDER BY r.created_at DESC`,
    )
      .bind(projectId)
      .all();
    return json({ items: items.results ?? [] });
  }

  const reviewDecide = rest.match(/^\/review\/([^/]+)\/(approve|reject)$/);
  if (reviewDecide && request.method === 'POST') {
    await requireProjectAccess(env, auth, projectId, 'editor');
    if (auth.permission === 'read') return error('Read-only key', 403);
    const itemId = reviewDecide[1];
    const action = reviewDecide[2];
    const item = await env.DB.prepare(
      `SELECT * FROM review_items WHERE id = ? AND project_id = ? AND status = 'pending'`,
    )
      .bind(itemId, projectId)
      .first<{
        id: string;
        doc_id: string;
        proposed_content: string;
        base_version: number;
      }>();
    if (!item) return error('Not found', 404);
    if (action === 'approve') {
      const doc = await env.DB.prepare(`SELECT path FROM docs WHERE id = ?`)
        .bind(item.doc_id)
        .first<{ path: string }>();
      if (!doc) return error('Doc missing', 404);
      const saved = await saveDoc(env, {
        projectId,
        docId: item.doc_id,
        path: doc.path,
        content: item.proposed_content,
        baseVersion: item.base_version,
        authorId: auth.userId,
        authorType: 'user',
        summary: 'Approved from review queue',
      });
      if (!saved.ok) {
        if (saved.error === 'version_conflict') {
          return error('version_conflict', 409, { currentVersion: (saved as { currentVersion: number }).currentVersion });
        }
        return error(saved.error, 400);
      }
    }
    await env.DB.prepare(
      `UPDATE review_items SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?`,
    )
      .bind(action === 'approve' ? 'approved' : 'rejected', nowIso(), auth.userId, itemId)
      .run();
    return json({ ok: true });
  }

  // Graph (simple nodes/edges from docs + covered paths)
  if (rest === '/graph' && request.method === 'GET') {
    await requireProjectAccess(env, auth, projectId, 'viewer');
    const docs = await env.DB.prepare(
      `SELECT id, path, title, covered_paths, covered_names, drift_status, repo_id FROM docs WHERE project_id = ?`,
    )
      .bind(projectId)
      .all<{
        id: string;
        path: string;
        title: string;
        covered_paths: string;
        covered_names: string;
        drift_status: string;
        repo_id: string | null;
      }>();
    const repos = await env.DB.prepare(`SELECT id, github_owner, github_name FROM repos WHERE project_id = ?`)
      .bind(projectId)
      .all<{ id: string; github_owner: string; github_name: string }>();
    const nodes = [
      ...(repos.results ?? []).map((r) => ({
        id: r.id,
        type: 'repo' as const,
        label: `${r.github_owner}/${r.github_name}`,
        drift: false,
      })),
      ...(docs.results ?? []).map((d) => ({
        id: d.id,
        type: 'doc' as const,
        label: d.title,
        path: d.path,
        drift: d.drift_status !== 'ok',
        repoId: d.repo_id,
      })),
    ];
    const edges: { from: string; to: string; kind: string }[] = [];
    const pathNodes = new Set<string>();
    const docsList = docs.results ?? [];
    for (const d of docsList) {
      // Prefer doc → repo so arrows read as "belongs to"
      if (d.repo_id) edges.push({ from: d.id, to: d.repo_id, kind: 'belongs' });
      let paths: string[] = [];
      try {
        paths = JSON.parse(d.covered_paths) as string[];
      } catch {
        /* ignore */
      }
      for (const p of paths) {
        const pid = `path:${p}`;
        edges.push({ from: d.id, to: pid, kind: 'covers' });
        if (!pathNodes.has(pid)) {
          pathNodes.add(pid);
          nodes.push({ id: pid, type: 'code', label: p, drift: false } as never);
        }
      }
    }
    // Doc ↔ doc when they share covered names (cross-doc relatedness)
    const namesByDoc = docsList.map((d) => {
      let names: string[] = [];
      try {
        names = (JSON.parse(d.covered_names) as string[]).map((n) => n.toLowerCase());
      } catch {
        names = [];
      }
      return { id: d.id, names: new Set(names) };
    });
    for (let i = 0; i < namesByDoc.length; i++) {
      for (let j = i + 1; j < namesByDoc.length; j++) {
        const a = namesByDoc[i];
        const b = namesByDoc[j];
        let shared = false;
        for (const n of a.names) {
          if (b.names.has(n)) {
            shared = true;
            break;
          }
        }
        if (shared) edges.push({ from: a.id, to: b.id, kind: 'related' });
      }
    }
    return json({ nodes, edges });
  }

  // Members
  if (rest === '/members' && request.method === 'GET') {
    await requireProjectAccess(env, auth, projectId, 'viewer');
    const rows = await env.DB.prepare(
      `SELECT pm.role, u.id, u.login, u.name, u.avatar_url
       FROM project_members pm JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = ?`,
    )
      .bind(projectId)
      .all();
    return json({ members: rows.results ?? [] });
  }

  if (rest === '/members' && request.method === 'POST') {
    await requireProjectAccess(env, auth, projectId, 'owner');
    const body = await readJson<{ login: string; role: 'owner' | 'editor' | 'viewer' }>(request);
    const user = await env.DB.prepare(`SELECT id FROM users WHERE login = ?`)
      .bind(body.login)
      .first<{ id: string }>();
    if (!user) return error('User must sign in once before being invited', 404);
    await env.DB.prepare(
      `INSERT INTO project_members (project_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(project_id, user_id) DO UPDATE SET role = excluded.role`,
    )
      .bind(projectId, user.id, body.role ?? 'viewer', nowIso())
      .run();
    return json({ ok: true });
  }

  // Share links
  if (rest === '/share' && request.method === 'POST') {
    await requireProjectAccess(env, auth, projectId, 'editor');
    if (auth.permission === 'read') return error('Read-only key', 403);
    const body = await readJson<{ doc_id?: string; expires_in_hours?: number }>(request);
    const raw = newToken(24);
    const tokenHash = await hashToken(raw);
    const id = newId('shr');
    const hours = body.expires_in_hours ?? 72;
    await env.DB.prepare(
      `INSERT INTO share_links (id, token_hash, project_id, doc_id, created_by, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        tokenHash,
        projectId,
        body.doc_id ?? null,
        auth.userId,
        addSecondsIso(hours * 3600),
        nowIso(),
      )
      .run();
    return json({ id, token: raw, url_path: `/share/${raw}` }, 201);
  }

  // Export
  if (rest === '/export' && request.method === 'GET') {
    await requireProjectAccess(env, auth, projectId, 'viewer');
    const files = await exportProjectMarkdown(env, projectId);
    // Return as a simple JSON bundle; clients can zip. Also support ?format=mdzip later.
    const url = new URL(request.url);
    if (url.searchParams.get('format') === 'multipart') {
      const boundary = 'driftless';
      let body = '';
      for (const f of files) {
        body += `--${boundary}\r\nContent-Disposition: attachment; filename="${f.path}"\r\nContent-Type: text/markdown\r\n\r\n${f.content}\r\n`;
      }
      body += `--${boundary}--\r\n`;
      return new Response(body, {
        headers: { 'Content-Type': `multipart/mixed; boundary=${boundary}` },
      });
    }
    return json({ files });
  }

  return error('Not found', 404);
}

async function handleDocRoutes(
  request: Request,
  env: Env,
  auth: Awaited<ReturnType<typeof requireAuth>>,
  projectId: string,
  docId: string,
  rest: string,
): Promise<Response> {
  await requireProjectAccess(env, auth, projectId, 'viewer');

  const meta = await env.DB.prepare(`SELECT * FROM docs WHERE id = ? AND project_id = ?`)
    .bind(docId, projectId)
    .first<{
      id: string;
      path: string;
      title: string;
      current_version: number;
      drift_status: string;
      covered_paths: string;
      covered_names: string;
    }>();
  if (!meta) return error('Not found', 404);

  if (rest === '' && request.method === 'GET') {
    const content = await readDocVersion(env, projectId, docId, meta.current_version);
    return json({ doc: meta, content });
  }

  if (rest === '/outline' && request.method === 'GET') {
    const content = await readDocVersion(env, projectId, docId, meta.current_version);
    if (content == null) return error('Content missing', 404);
    const { body } = parseFrontmatter(content);
    return json({ outline: outlineFromSections(splitSections(body)), version: meta.current_version });
  }

  const sectionMatch = rest.match(/^\/sections\/(.+)$/);
  if (sectionMatch && request.method === 'GET') {
    const heading = decodeURIComponent(sectionMatch[1]);
    const content = await readDocVersion(env, projectId, docId, meta.current_version);
    if (content == null) return error('Content missing', 404);
    const { body } = parseFrontmatter(content);
    const sections = splitSections(body);
    const sec = sections.find(
      (s) => s.heading === heading || s.heading.toLowerCase() === heading.toLowerCase(),
    );
    if (!sec) return error('Section not found', 404);
    return json({ heading: sec.heading, content: sec.content, version: meta.current_version });
  }

  // Full replace with optimistic version
  if (rest === '' && request.method === 'PUT') {
    await requireProjectAccess(env, auth, projectId, 'editor');
    const body = await readJson<{ content: string; base_version: number; summary?: string }>(
      request,
    );
    if (body.content == null || body.base_version == null) {
      return error('content and base_version required');
    }
    return applyEdit(env, auth, projectId, meta, body.content, body.base_version, body.summary);
  }

  // Section patch
  if (rest === '/patch' && request.method === 'POST') {
    await requireProjectAccess(env, auth, projectId, 'editor');
    const body = await readJson<{
      heading: string;
      content: string;
      base_version: number;
      summary?: string;
    }>(request);
    if (!body.heading || body.content == null || body.base_version == null) {
      return error('heading, content, base_version required');
    }
    const current = await readDocVersion(env, projectId, docId, meta.current_version);
    if (current == null) return error('Content missing', 404);
    if (meta.current_version !== body.base_version) {
      return error('version_conflict', 409, { currentVersion: meta.current_version });
    }
    const { frontmatter: _fm, body: mdBody } = parseFrontmatter(current);
    const fmMatch = current.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    const prefix = fmMatch ? fmMatch[0] : '';
    const patched = applySectionPatch(mdBody, body.heading, body.content);
    if (!patched.ok) return error(patched.error, 404);
    const nextContent = prefix + patched.body;
    return applyEdit(env, auth, projectId, meta, nextContent, body.base_version, body.summary);
  }

  return error('Not found', 404);
}

async function applyEdit(
  env: Env,
  auth: Awaited<ReturnType<typeof requireAuth>>,
  projectId: string,
  meta: { id: string; path: string; current_version: number },
  content: string,
  baseVersion: number,
  summary?: string,
): Promise<Response> {
  if (auth.permission === 'read') return error('Read-only key', 403);

  const project = await env.DB.prepare(`SELECT trust_mode FROM projects WHERE id = ?`)
    .bind(projectId)
    .first<{ trust_mode: TrustMode }>();
  if (!project) return error('Project missing', 404);

  const current = await readDocVersion(env, projectId, meta.id, meta.current_version);
  const before = current ?? '';
  const source = auth.via === 'api_key' ? 'agent' : 'user';
  const decision = decideEdit({
    trustMode: project.trust_mode,
    permission: auth.permission,
    source,
    change: {
      size: estimateChangeSize(before, content),
      isSmallSafeFix: isSmallSafeFix(before, content),
    },
  });

  if (decision.action === 'reject') return error(decision.reason, 403);

  if (decision.action === 'queue_review') {
    const id = newId('rev');
    await env.DB.prepare(
      `INSERT INTO review_items (id, project_id, doc_id, proposed_content, base_version, summary, source, author_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'agent', ?, 'pending', ?)`,
    )
      .bind(id, projectId, meta.id, content, baseVersion, summary ?? null, auth.userId, nowIso())
      .run();
    await env.DB.prepare(`UPDATE docs SET drift_status = 'review' WHERE id = ?`).bind(meta.id).run();
    return json({ queued: true, review_id: id, reason: decision.reason }, 202);
  }

  const saved = await saveDoc(env, {
    projectId,
    docId: meta.id,
    path: meta.path,
    content,
    baseVersion,
    authorId: auth.userId,
    authorType: source === 'agent' ? 'agent' : 'user',
    summary,
  });
  if (!saved.ok) {
    if (saved.error === 'version_conflict') {
      return error('version_conflict', 409, {
        currentVersion: (saved as { currentVersion: number }).currentVersion,
        message: 'Doc changed; re-read and retry',
      });
    }
    return error(saved.error, 400);
  }

  // Debounced embedding queue if enabled
  const emb = await env.DB.prepare(`SELECT embeddings_enabled FROM projects WHERE id = ?`)
    .bind(projectId)
    .first<{ embeddings_enabled: number }>();
  if (emb?.embeddings_enabled) {
    const scheduled = addSecondsIso(60);
    await env.DB.prepare(
      `INSERT INTO embedding_jobs (doc_id, project_id, scheduled_at, status) VALUES (?, ?, ?, 'pending')
       ON CONFLICT(doc_id) DO UPDATE SET scheduled_at = excluded.scheduled_at, status = 'pending'`,
    )
      .bind(meta.id, projectId, scheduled)
      .run();
    await env.JOBS.send({
      type: 'embed_doc',
      projectId,
      docId: meta.id,
    });
  }

  return json({ saved: true, version: saved.version, title: saved.title });
}
