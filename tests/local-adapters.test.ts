import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/local/config';
import { createLocalEnv, LOCAL_USER_ID } from '../src/local/bootstrap';
import { saveDoc, searchDocs, readDocVersion } from '../src/storage/docs';
import { startRepoWatcher } from '../src/local/watcher';
import { newId } from '../src/util/id';
import { nowIso } from '../src/util/time';

const migrationsDir = join(process.cwd(), 'migrations');

describe('local adapters', () => {
  let dataDir: string;
  let close: (() => void) | undefined;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'driftless-test-'));
  });

  afterEach(() => {
    close?.();
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('sqlite + fs docs: save, search, read', async () => {
    const cfg = loadConfig({ dataDir });
    const { env, projectId } = await createLocalEnv(cfg, migrationsDir);
    const docId = newId('doc');
    const content = `---
title: Drift matching
covered_paths:
  - src/drift/**
covered_names:
  - runDriftCheck
---

# Drift matching

Docs about path matching.
`;
    const saved = await saveDoc(env, {
      projectId,
      docId,
      path: 'drift.md',
      content,
      baseVersion: null,
      authorId: LOCAL_USER_ID,
      authorType: 'user',
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const round = await readDocVersion(env, projectId, docId, saved.version);
    expect(round).toContain('runDriftCheck');
    const hits = await searchDocs(env, projectId, 'matching');
    expect(hits.some((h) => h.doc_id === docId)).toBe(true);
  });

  it('watcher → drift flag on covered path change', async () => {
    const cfg = loadConfig({ dataDir });
    const { env, projectId } = await createLocalEnv(cfg, migrationsDir);

    const repoRoot = join(dataDir, 'sample-repo');
    mkdirSync(join(repoRoot, 'src/drift'), { recursive: true });
    writeFileSync(join(repoRoot, 'src/drift/match.ts'), 'export const x = 1;\n');

    const repoId = newId('repo');
    const ts = nowIso();
    await env.DB.prepare(
      `INSERT INTO repos (id, project_id, github_owner, github_name, default_branch, local_path, created_at, updated_at)
       VALUES (?, ?, 'local', 'sample', 'main', ?, ?, ?)`,
    )
      .bind(repoId, projectId, repoRoot, ts, ts)
      .run();

    const docId = newId('doc');
    const saved = await saveDoc(env, {
      projectId,
      docId,
      path: 'drift.md',
      content: `---
title: Drift
covered_paths:
  - src/drift/**
---
# Drift
`,
      baseVersion: null,
      authorId: LOCAL_USER_ID,
      authorType: 'user',
    });
    expect(saved.ok).toBe(true);

    const w = startRepoWatcher(
      env,
      [{ repoId, projectId, localPath: repoRoot }],
      { debounceMs: 100 },
    );
    close = () => {
      void w.close();
    };

    // mutate covered file
    await new Promise((r) => setTimeout(r, 50));
    writeFileSync(join(repoRoot, 'src/drift/match.ts'), 'export const x = 2;\n');

    // wait for debounce + job
    let stale = false;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const doc = await env.DB.prepare(`SELECT drift_status FROM docs WHERE id = ?`)
        .bind(docId)
        .first<{ drift_status: string }>();
      if (doc?.drift_status === 'stale') {
        stale = true;
        break;
      }
    }
    expect(stale).toBe(true);

    const flags = await env.DB.prepare(
      `SELECT status FROM drift_flags WHERE doc_id = ? AND status = 'open'`,
    )
      .bind(docId)
      .all();
    expect((flags.results ?? []).length).toBeGreaterThan(0);

    await w.close();
    close = undefined;
  }, 15000);
});
