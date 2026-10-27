import { requireAuth, requireProjectAccess, AuthError, isAuthError } from '../auth/context';
import { readDocVersion, saveDoc, searchDocs } from '../storage/docs';
import { searchAll } from '../search/code-index';
import { decideEdit, estimateChangeSize, isSmallSafeFix } from '../trust/modes';
import type { Env, TrustMode } from '../types';
import {
  applySectionPatch,
  outlineFromSections,
  parseFrontmatter,
  splitSections,
} from '../util/markdown';
import { newId } from '../util/id';
import { addSecondsIso, nowIso } from '../util/time';

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

const TOOLS = [
  {
    name: 'search_docs',
    description: 'Keyword search docs in a project (FTS5)',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        query: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['project_id', 'query'],
    },
  },
  {
    name: 'search_all',
    description: 'Unified keyword search across docs and indexed code (FTS5)',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        query: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['project_id', 'query'],
    },
  },
  {
    name: 'list_docs',
    description: 'List docs in a project',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        repo_id: { type: 'string' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'read_doc',
    description: 'Read a full doc by id',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        doc_id: { type: 'string' },
      },
      required: ['project_id', 'doc_id'],
    },
  },
  {
    name: 'read_outline',
    description: 'Read heading outline of a doc',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        doc_id: { type: 'string' },
      },
      required: ['project_id', 'doc_id'],
    },
  },
  {
    name: 'read_section',
    description: 'Read a single section by heading',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        doc_id: { type: 'string' },
        heading: { type: 'string' },
      },
      required: ['project_id', 'doc_id', 'heading'],
    },
  },
  {
    name: 'recent_changes',
    description: 'List recent doc versions in a project',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'drift_status',
    description: 'Get open drift flags for a doc or whole project',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        doc_id: { type: 'string' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'edit_section',
    description:
      'Patch one section of a doc with optimistic base_version. Follows project trust mode; API key permissions always win.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        doc_id: { type: 'string' },
        heading: { type: 'string' },
        content: { type: 'string', description: 'Full replacement for the section including heading line' },
        base_version: { type: 'number' },
        summary: { type: 'string' },
      },
      required: ['project_id', 'doc_id', 'heading', 'content', 'base_version'],
    },
  },
  {
    name: 'query_code_graph',
    description: 'Query Graft code graph when enabled (files/APIs). Returns unavailable if Graft is off.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        query: { type: 'string' },
      },
      required: ['project_id', 'query'],
    },
  },
];

export async function handleMcp(request: Request, env: Env): Promise<Response> {
  if (request.method === 'GET') {
    return new Response(
      JSON.stringify({
        name: 'driftless',
        version: '0.1.0',
        transport: 'http+jsonrpc',
        auth: 'Bearer dl_... API key',
        tools: TOOLS.map((t) => t.name),
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  }

  if (request.method !== 'POST') {
    return rpcError(null, -32600, 'Method not allowed', 405);
  }

  let auth;
  try {
    auth = await requireAuth(env, request);
  } catch (e) {
    const status = Number((e as { status?: unknown })?.status);
    if (status === 401 || status === 403 || isAuthError(e)) {
      const msg = e instanceof Error ? e.message : 'Unauthorized';
      const st = isAuthError(e) ? e.status : status || 401;
      return rpcError(null, -32001, msg, st);
    }
    throw e;
  }

  let body: JsonRpcRequest;
  try {
    body = (await request.json()) as JsonRpcRequest;
  } catch {
    return rpcError(null, -32700, 'Parse error');
  }

  const id = body.id ?? null;

  try {
    if (body.method === 'initialize') {
      return rpcResult(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'driftless', version: '0.1.0' },
      });
    }
    if (body.method === 'tools/list' || body.method === 'list_tools') {
      return rpcResult(id, { tools: TOOLS });
    }
    if (body.method === 'tools/call' || body.method === 'call_tool') {
      const params = body.params ?? {};
      const name = (params.name as string) || (params.tool as string);
      const args = (params.arguments as Record<string, unknown>) || (params.input as Record<string, unknown>) || {};
      const result = await callTool(env, auth, name, args);
      return rpcResult(id, {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: result && typeof result === 'object' && 'error' in (result as object),
      });
    }
    // Allow direct tool names for simpler clients
    if (TOOLS.some((t) => t.name === body.method)) {
      const result = await callTool(env, auth, body.method, body.params ?? {});
      return rpcResult(id, result);
    }
    return rpcError(id, -32601, `Method not found: ${body.method}`);
  } catch (e) {
    const status = Number((e as { status?: unknown })?.status);
    if (status === 401 || status === 403 || isAuthError(e)) {
      const msg = e instanceof Error ? e.message : 'Unauthorized';
      const st = isAuthError(e) ? e.status : status || 401;
      return rpcError(id, -32001, msg, st);
    }
    console.error(e);
    return rpcError(id, -32000, e instanceof Error ? e.message : 'Internal error');
  }
}

async function callTool(
  env: Env,
  auth: Awaited<ReturnType<typeof requireAuth>>,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const projectId = String(args.project_id ?? '');
  if (!projectId) return { error: 'project_id required' };
  await requireProjectAccess(env, auth, projectId, 'viewer');

  switch (name) {
    case 'search_all': {
      const projectId = String(args.project_id || '');
      const query = String(args.query || '');
      const limit = Number(args.limit || 20);
      await requireProjectAccess(env, auth, projectId, 'viewer');
      const results = await searchAll(env, projectId, query, limit);
      return results;
    }
    case 'search_docs': {
      const hits = await searchDocs(env, projectId, String(args.query ?? ''), Number(args.limit ?? 20));
      return { results: hits };
    }
    case 'list_docs': {
      let sql = `SELECT id, path, title, current_version, drift_status, repo_id FROM docs WHERE project_id = ?`;
      const binds: unknown[] = [projectId];
      if (args.repo_id) {
        sql += ` AND repo_id = ?`;
        binds.push(String(args.repo_id));
      }
      sql += ` ORDER BY path`;
      const rows = await env.DB.prepare(sql)
        .bind(...binds)
        .all();
      return { docs: rows.results ?? [] };
    }
    case 'read_doc': {
      const docId = String(args.doc_id);
      const meta = await env.DB.prepare(`SELECT * FROM docs WHERE id = ? AND project_id = ?`)
        .bind(docId, projectId)
        .first();
      if (!meta) return { error: 'not_found' };
      const content = await readDocVersion(
        env,
        projectId,
        docId,
        (meta as { current_version: number }).current_version,
      );
      return { doc: meta, content };
    }
    case 'read_outline': {
      const docId = String(args.doc_id);
      const meta = await env.DB.prepare(
        `SELECT current_version FROM docs WHERE id = ? AND project_id = ?`,
      )
        .bind(docId, projectId)
        .first<{ current_version: number }>();
      if (!meta) return { error: 'not_found' };
      const content = await readDocVersion(env, projectId, docId, meta.current_version);
      if (content == null) return { error: 'content_missing' };
      const { body } = parseFrontmatter(content);
      return { outline: outlineFromSections(splitSections(body)), version: meta.current_version };
    }
    case 'read_section': {
      const docId = String(args.doc_id);
      const heading = String(args.heading);
      const meta = await env.DB.prepare(
        `SELECT current_version FROM docs WHERE id = ? AND project_id = ?`,
      )
        .bind(docId, projectId)
        .first<{ current_version: number }>();
      if (!meta) return { error: 'not_found' };
      const content = await readDocVersion(env, projectId, docId, meta.current_version);
      if (content == null) return { error: 'content_missing' };
      const { body } = parseFrontmatter(content);
      const sec = splitSections(body).find(
        (s) => s.heading === heading || s.heading.toLowerCase() === heading.toLowerCase(),
      );
      if (!sec) return { error: 'section_not_found' };
      return { heading: sec.heading, content: sec.content, version: meta.current_version };
    }
    case 'recent_changes': {
      const limit = Number(args.limit ?? 20);
      const rows = await env.DB.prepare(
        `SELECT dv.version, dv.summary, dv.author_type, dv.created_at, d.id AS doc_id, d.path, d.title
         FROM doc_versions dv JOIN docs d ON d.id = dv.doc_id
         WHERE d.project_id = ?
         ORDER BY dv.created_at DESC LIMIT ?`,
      )
        .bind(projectId, limit)
        .all();
      return { changes: rows.results ?? [] };
    }
    case 'drift_status': {
      let sql = `SELECT f.*, d.path, d.title FROM drift_flags f JOIN docs d ON d.id = f.doc_id
                 WHERE f.project_id = ? AND f.status = 'open'`;
      const binds: unknown[] = [projectId];
      if (args.doc_id) {
        sql += ` AND f.doc_id = ?`;
        binds.push(String(args.doc_id));
      }
      sql += ` ORDER BY f.created_at DESC`;
      const rows = await env.DB.prepare(sql)
        .bind(...binds)
        .all();
      return { flags: rows.results ?? [] };
    }
    case 'edit_section': {
      await requireProjectAccess(env, auth, projectId, 'editor');
      if (auth.permission === 'read') return { error: 'read_only_key' };
      const docId = String(args.doc_id);
      const heading = String(args.heading);
      const sectionContent = String(args.content);
      const baseVersion = Number(args.base_version);
      const meta = await env.DB.prepare(
        `SELECT id, path, current_version FROM docs WHERE id = ? AND project_id = ?`,
      )
        .bind(docId, projectId)
        .first<{ id: string; path: string; current_version: number }>();
      if (!meta) return { error: 'not_found' };
      if (meta.current_version !== baseVersion) {
        return {
          error: 'version_conflict',
          currentVersion: meta.current_version,
          message: 'Re-read the doc and retry',
        };
      }
      const current = await readDocVersion(env, projectId, docId, meta.current_version);
      if (current == null) return { error: 'content_missing' };
      const fmMatch = current.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
      const prefix = fmMatch ? fmMatch[0] : '';
      const { body } = parseFrontmatter(current);
      const patched = applySectionPatch(body, heading, sectionContent);
      if (!patched.ok) return { error: patched.error };
      const nextContent = prefix + patched.body;

      const project = await env.DB.prepare(`SELECT trust_mode, embeddings_enabled FROM projects WHERE id = ?`)
        .bind(projectId)
        .first<{ trust_mode: TrustMode; embeddings_enabled: number }>();
      if (!project) return { error: 'project_missing' };

      const decision = decideEdit({
        trustMode: project.trust_mode,
        permission: auth.permission,
        source: 'agent',
        change: {
          size: estimateChangeSize(current, nextContent),
          isSmallSafeFix: isSmallSafeFix(current, nextContent),
        },
      });

      if (decision.action === 'reject') return { error: decision.reason };
      if (decision.action === 'queue_review') {
        const id = newId('rev');
        await env.DB.prepare(
          `INSERT INTO review_items (id, project_id, doc_id, proposed_content, base_version, summary, source, author_id, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'agent', ?, 'pending', ?)`,
        )
          .bind(
            id,
            projectId,
            docId,
            nextContent,
            baseVersion,
            args.summary ? String(args.summary) : null,
            auth.userId,
            nowIso(),
          )
          .run();
        return { queued: true, review_id: id, reason: decision.reason };
      }

      const saved = await saveDoc(env, {
        projectId,
        docId,
        path: meta.path,
        content: nextContent,
        baseVersion,
        authorId: auth.userId,
        authorType: 'agent',
        summary: args.summary ? String(args.summary) : undefined,
      });
      if (!saved.ok) {
        if (saved.error === 'version_conflict') {
          return {
            error: 'version_conflict',
            currentVersion: (saved as { currentVersion: number }).currentVersion,
            message: 'Re-read the doc and retry',
          };
        }
        return { error: saved.error };
      }
      if (project.embeddings_enabled) {
        await env.DB.prepare(
          `INSERT INTO embedding_jobs (doc_id, project_id, scheduled_at, status) VALUES (?, ?, ?, 'pending')
           ON CONFLICT(doc_id) DO UPDATE SET scheduled_at = excluded.scheduled_at, status = 'pending'`,
        )
          .bind(docId, projectId, addSecondsIso(60))
          .run();
        await env.JOBS.send({ type: 'embed_doc', projectId, docId });
      }
      return { saved: true, version: saved.version };
    }
    case 'query_code_graph': {
      const project = await env.DB.prepare(`SELECT graft_enabled FROM projects WHERE id = ?`)
        .bind(projectId)
        .first<{ graft_enabled: number }>();
      if (!project?.graft_enabled) {
        return { available: false, message: 'Graft is disabled for this project' };
      }
      const prefix = `projects/${projectId}/graft/`;
      const listed = await env.DOCS.list({ prefix, limit: 50 });
      const q = String(args.query ?? '').toLowerCase();
      const hits: string[] = [];
      for (const obj of listed.objects) {
        if (!q || obj.key.toLowerCase().includes(q)) hits.push(obj.key.slice(prefix.length));
      }
      return { available: true, files: hits };
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

function rpcResult(id: string | number | null, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function rpcError(
  id: string | number | null,
  code: number,
  message: string,
  httpStatus = 200,
): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }), {
    status: httpStatus,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Pure helpers exported for unit tests */
export function listMcpToolNames(): string[] {
  return TOOLS.map((t) => t.name);
}

export function getMcpTools() {
  return TOOLS;
}
