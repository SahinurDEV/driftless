import chokidar from 'chokidar';
import { relative, resolve } from 'node:path';
import type { Env, QueueMessage } from '../types/env';

export interface WatchedRepo {
  repoId: string;
  projectId: string;
  localPath: string;
}

/**
 * Watch local repo folders; debounce and enqueue the same drift_check job
 * the GitHub webhook would send.
 */
export function startRepoWatcher(
  env: Env,
  repos: WatchedRepo[],
  opts: { debounceMs?: number } = {},
): { close: () => Promise<void> } {
  const debounceMs = opts.debounceMs ?? 400;
  const pending = new Map<string, { paths: Set<string>; timer: NodeJS.Timeout }>();

  const watchers = repos
    .filter((r) => r.localPath)
    .map((repo) => {
      const root = resolve(repo.localPath);
      const w = chokidar.watch(root, {
        ignoreInitial: true,
        ignored: [
          /(^|[/\\])\../,
          '**/node_modules/**',
          '**/.git/**',
          '**/dist/**',
          '**/.driftless/**',
          '**/dashboard/dist/**',
        ],
        awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
      });

      const onChange = (absPath: string) => {
        let rel = relative(root, absPath).replace(/\\/g, '/');
        if (!rel || rel.startsWith('..')) return;
        const key = repo.repoId;
        let entry = pending.get(key);
        if (!entry) {
          entry = { paths: new Set(), timer: null as unknown as NodeJS.Timeout };
          pending.set(key, entry);
        }
        entry.paths.add(rel);
        clearTimeout(entry.timer);
        entry.timer = setTimeout(() => {
          const paths = [...entry!.paths];
          pending.delete(key);
          const msg: QueueMessage = {
            type: 'drift_check',
            projectId: repo.projectId,
            repoId: repo.repoId,
            changedPaths: paths,
            changedNames: [],
            commitSha: `local-${Date.now()}`,
          };
          void env.JOBS.send(msg).catch((e) => console.error('drift enqueue failed', e));
        }, debounceMs);
      };

      w.on('add', onChange);
      w.on('change', onChange);
      w.on('unlink', onChange);
      return w;
    });

  return {
    async close() {
      await Promise.all(watchers.map((w) => w.close()));
    },
  };
}

export async function loadWatchedRepos(env: Env): Promise<WatchedRepo[]> {
  const rows = await env.DB.prepare(
    `SELECT id, project_id, local_path FROM repos WHERE local_path IS NOT NULL AND local_path != ''`,
  ).all<{ id: string; project_id: string; local_path: string }>();
  return (rows.results ?? []).map((r) => ({
    repoId: r.id,
    projectId: r.project_id,
    localPath: r.local_path,
  }));
}
