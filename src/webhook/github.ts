import type { Env, QueueMessage } from '../types';
import { extractNamesFromDiff } from '../util/markdown';
import { json } from '../api/json';

async function verifySignature(
  secret: string,
  payload: string,
  signatureHeader: string | null,
): Promise<boolean> {
  if (!signatureHeader?.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `sha256=${hex}` === signatureHeader;
}

export async function handleGitHubWebhook(request: Request, env: Env): Promise<Response> {
  const payload = await request.text();
  const event = request.headers.get('X-GitHub-Event') ?? '';
  const sig = request.headers.get('X-Hub-Signature-256');

  if (env.WEBHOOK_SECRET) {
    const ok = await verifySignature(env.WEBHOOK_SECRET, payload, sig);
    if (!ok) return json({ error: 'Invalid signature' }, 401);
  }

  if (event === 'ping') return json({ ok: true, pong: true });
  if (event !== 'push') return json({ ok: true, ignored: event });

  let body: {
    ref?: string;
    after?: string;
    repository?: { owner?: { login?: string }; name?: string; full_name?: string };
    commits?: { added?: string[]; modified?: string[]; removed?: string[]; message?: string }[];
  };
  try {
    body = JSON.parse(payload);
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const owner = body.repository?.owner?.login;
  const name = body.repository?.name;
  if (!owner || !name) return json({ error: 'Missing repository' }, 400);

  const repo = await env.DB.prepare(
    `SELECT r.id, r.project_id, r.default_branch, p.graft_enabled
     FROM repos r JOIN projects p ON p.id = r.project_id
     WHERE r.github_owner = ? AND r.github_name = ?`,
  )
    .bind(owner, name)
    .first<{
      id: string;
      project_id: string;
      default_branch: string;
      graft_enabled: number;
    }>();

  if (!repo) return json({ ok: true, message: 'Repo not connected' });

  const branch = (body.ref ?? '').replace(/^refs\/heads\//, '');
  if (branch && branch !== repo.default_branch) {
    return json({ ok: true, message: 'Ignored non-default branch' });
  }

  const changedPaths = new Set<string>();
  const textBits: string[] = [];
  for (const c of body.commits ?? []) {
    for (const p of [...(c.added ?? []), ...(c.modified ?? []), ...(c.removed ?? [])]) {
      changedPaths.add(p);
    }
    if (c.message) textBits.push(c.message);
  }
  const changedNames = extractNamesFromDiff(textBits.join('\n') + '\n' + [...changedPaths].join('\n'));

  const msg: QueueMessage = {
    type: 'drift_check',
    projectId: repo.project_id,
    repoId: repo.id,
    commitSha: body.after,
    changedPaths: [...changedPaths],
    changedNames,
    graftEnabled: !!repo.graft_enabled,
  };
  await env.JOBS.send(msg);
  return json({ ok: true, queued: true, paths: changedPaths.size });
}
