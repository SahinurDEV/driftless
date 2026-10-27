import type { Env } from '../types';

export type WebhookType = 'slack' | 'discord' | 'generic';

export interface DriftNotifyPayload {
  projectId: string;
  projectName?: string;
  flagId: string;
  docTitle: string;
  docPath: string;
  reason: string;
  matchType: string;
  dashboardUrl?: string;
}

export function formatSlackPayload(p: DriftNotifyPayload) {
  const link = p.dashboardUrl ? `\n<${p.dashboardUrl}|Open in Driftless>` : '';
  return {
    text: `Drift flagged: *${p.docTitle}* — ${p.reason}${link}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*:warning: Doc drift detected*\n*${p.docTitle}* (\`${p.docPath}\`)\n${p.reason}\n_match: ${p.matchType}_${link}`,
        },
      },
    ],
  };
}

export function formatDiscordPayload(p: DriftNotifyPayload) {
  const link = p.dashboardUrl ? `\n[Open in Driftless](${p.dashboardUrl})` : '';
  return {
    content: `⚠️ **Doc drift detected**\n**${p.docTitle}** (\`${p.docPath}\`)\n${p.reason}\n_match: ${p.matchType}_${link}`,
  };
}

export function formatGenericPayload(p: DriftNotifyPayload) {
  return { event: 'drift_flag', ...p };
}

export async function sendWebhook(
  url: string,
  type: WebhookType,
  payload: DriftNotifyPayload,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  if (!url) return { ok: false, error: 'missing url' };
  let body: unknown;
  if (type === 'discord') body = formatDiscordPayload(payload);
  else if (type === 'generic') body = formatGenericPayload(payload);
  else body = formatSlackPayload(payload);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, status: res.status, error: await res.text().catch(() => '') };
    return { ok: true, status: res.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function notifyProjectDrift(
  env: Env,
  projectId: string,
  payload: Omit<DriftNotifyPayload, 'projectId'>,
): Promise<void> {
  const row = await env.DB.prepare(
    `SELECT name, notify_webhook_url, notify_webhook_type FROM projects WHERE id = ?`,
  )
    .bind(projectId)
    .first<{ name: string; notify_webhook_url: string | null; notify_webhook_type: string | null }>();
  if (!row?.notify_webhook_url) return;
  const type = (row.notify_webhook_type as WebhookType) || 'slack';
  const base = env.APP_BASE_URL || (env.LOCAL_MODE ? 'http://127.0.0.1:4747' : '');
  await sendWebhook(row.notify_webhook_url, type, {
    projectId,
    projectName: row.name,
    dashboardUrl: base ? `${base}/projects/${projectId}/drift` : undefined,
    ...payload,
  });
}
