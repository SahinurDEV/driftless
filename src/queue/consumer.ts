import { runDriftCheck, type DocCoverage } from '../drift/match';
import { readDocVersion } from '../storage/docs';
import type { Env, QueueMessage } from '../types';
import { newId } from '../util/id';
import { nowIso } from '../util/time';

export async function handleQueueBatch(
  batch: MessageBatch<QueueMessage>,
  env: Env,
): Promise<void> {
  for (const msg of batch.messages) {
    try {
      await processQueueMessage(msg.body, env);
      msg.ack();
    } catch (e) {
      console.error('queue error', e);
      msg.retry();
    }
  }
}

export async function processQueueMessage(body: QueueMessage, env: Env): Promise<void> {
  switch (body.type) {
    case 'drift_check':
      await runDriftJob(env, body);
      break;
    case 'embed_doc':
      await runEmbedJob(env, body);
      break;
    case 'reindex_doc':
      // reindex is handled via saveDoc FTS; noop placeholder
      break;
  }
}

export async function runDriftJob(env: Env, body: QueueMessage): Promise<void> {
  const changedPaths = body.changedPaths ?? [];
  const changedNames = body.changedNames ?? [];
  if (!changedPaths.length && !changedNames.length) return;

  const rows = await env.DB.prepare(
    `SELECT id, path, title, covered_paths, covered_names FROM docs WHERE project_id = ?`,
  )
    .bind(body.projectId)
    .all<{
      id: string;
      path: string;
      title: string;
      covered_paths: string;
      covered_names: string;
    }>();

  const docs: DocCoverage[] = (rows.results ?? []).map((d) => ({
    id: d.id,
    path: d.path,
    title: d.title,
    coveredPaths: safeJsonArray(d.covered_paths),
    coveredNames: safeJsonArray(d.covered_names),
  }));

  // Cross-repo FTS keyword hits for changed names
  const keywordHits = new Map<string, string[]>();
  for (const name of changedNames.slice(0, 30)) {
    const safe = name.replace(/["']/g, '');
    if (!safe) continue;
    const hits = await env.DB.prepare(
      `SELECT doc_id FROM docs_fts WHERE project_id = ? AND docs_fts MATCH ? LIMIT 50`,
    )
      .bind(body.projectId, `"${safe}"`)
      .all<{ doc_id: string }>();
    for (const h of hits.results ?? []) {
      const arr = keywordHits.get(h.doc_id) ?? [];
      arr.push(name);
      keywordHits.set(h.doc_id, arr);
    }
  }

  // Optional Graft: if enabled, look for graft markdown mentioning changed paths
  if (body.graftEnabled) {
    const prefix = `projects/${body.projectId}/graft/`;
    const listed = await env.DOCS.list({ prefix, limit: 100 });
    for (const obj of listed.objects) {
      const text = await (await env.DOCS.get(obj.key))?.text();
      if (!text) continue;
      for (const p of changedPaths) {
        if (text.includes(p)) {
          // Find docs that cover this graft file name
          for (const d of docs) {
            if (d.coveredPaths.some((cp) => text.includes(cp) || cp.includes(p))) {
              const arr = keywordHits.get(d.id) ?? [];
              arr.push(`graft:${p}`);
              keywordHits.set(d.id, arr);
            }
          }
        }
      }
    }
  }

  const matches = runDriftCheck({ docs, changedPaths, changedNames, keywordHits });
  const ts = nowIso();
  for (const m of matches) {
    const id = newId('drf');
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO drift_flags (id, doc_id, project_id, repo_id, reason, match_type, changed_paths, changed_names, commit_sha, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
      ).bind(
        id,
        m.docId,
        body.projectId,
        body.repoId ?? null,
        m.reason,
        m.matchType,
        JSON.stringify(m.matchedPaths),
        JSON.stringify(m.matchedNames),
        body.commitSha ?? null,
        ts,
      ),
      env.DB.prepare(`UPDATE docs SET drift_status = 'stale' WHERE id = ? AND drift_status = 'ok'`).bind(
        m.docId,
      ),
    ]);
  }
}

async function runEmbedJob(env: Env, body: QueueMessage): Promise<void> {
  if (!body.docId) return;
  if (!env.AI || !env.VECTORIZE) {
    console.log('embed skipped: AI/VECTORIZE not bound');
    return;
  }
  const job = await env.DB.prepare(
    `SELECT scheduled_at, status FROM embedding_jobs WHERE doc_id = ?`,
  )
    .bind(body.docId)
    .first<{ scheduled_at: string; status: string }>();
  if (!job || job.status !== 'pending') return;
  // Debounce: wait until scheduled_at
  if (new Date(job.scheduled_at).getTime() > Date.now()) {
    // re-queue later — for simplicity, skip; next edit will re-schedule
    return;
  }

  const meta = await env.DB.prepare(
    `SELECT current_version, title FROM docs WHERE id = ? AND project_id = ?`,
  )
    .bind(body.docId, body.projectId)
    .first<{ current_version: number; title: string }>();
  if (!meta) return;
  const content = await readDocVersion(env, body.projectId, body.docId, meta.current_version);
  if (!content) return;

  const result = (await env.AI.run('@cf/baai/bge-base-en-v1.5' as any, {
    text: [content.slice(0, 6000)],
  })) as { data?: number[][] };

  const values = result.data?.[0];
  if (!values) return;

  await env.VECTORIZE.upsert([
    {
      id: body.docId,
      values,
      metadata: { projectId: body.projectId, title: meta.title },
    },
  ]);
  await env.DB.prepare(`UPDATE embedding_jobs SET status = 'done' WHERE doc_id = ?`)
    .bind(body.docId)
    .run();
}

function safeJsonArray(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}
