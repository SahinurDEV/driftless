import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { LocalConfig } from './config';
import { openLibsql, type LibsqlDb } from './sqlite-db';
import { FsDocsBucket } from './fs-docs';
import { createLocalQueue } from './queue';
import type { Env } from '../types/env';
import { newId, newToken } from '../util/id';
import { nowIso } from '../util/time';
import { hashToken } from '../util/hash';

export const LOCAL_USER_ID = 'user_local';
export const LOCAL_LOGIN = 'local';

const MIGRATIONS = ['0001_init.sql', '0002_local_path.sql', '0003_features.sql'];

export async function ensureDataDir(cfg: LocalConfig): Promise<void> {
  await mkdir(cfg.dataDir, { recursive: true });
  await mkdir(cfg.docsDir, { recursive: true });
}

export async function applyMigrations(db: LibsqlDb, migrationsDir: string): Promise<void> {
  await db.client.execute(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
  for (const file of MIGRATIONS) {
    const done = await db.client.execute({
      sql: `SELECT id FROM _migrations WHERE id = ?`,
      args: [file],
    });
    if (done.rows.length) continue;
    const sql = await readFile(join(migrationsDir, file), 'utf8');
    const statements = splitSql(sql);
    for (const stmt of statements) {
      try {
        await db.client.execute(stmt);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // ignore duplicate column on re-run of ALTER
        if (/duplicate column/i.test(msg)) continue;
        console.error('migration statement failed in', file, msg, '\n', stmt.slice(0, 120));
        throw e;
      }
    }
    await db.client.execute({
      sql: `INSERT INTO _migrations (id, applied_at) VALUES (?, ?)`,
      args: [file, nowIso()],
    });
  }
}

function splitSql(sql: string): string[] {
  // Strip line comments, keep statements separated by semicolons
  const noComments = sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      if (idx >= 0) return line.slice(0, idx);
      return line;
    })
    .join('\n');
  return noComments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^PRAGMA\s+foreign_keys/i.test(s));
}

export async function ensureLocalUser(db: LibsqlDb): Promise<void> {
  const existing = await db
    .prepare(`SELECT id FROM users WHERE id = ?`)
    .bind(LOCAL_USER_ID)
    .first();
  if (existing) return;
  const ts = nowIso();
  await db.batch([
    db
      .prepare(
        `INSERT INTO users (id, github_id, login, name, email, avatar_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(LOCAL_USER_ID, 'local', LOCAL_LOGIN, 'Local User', null, null, ts, ts),
  ]);
}

export async function ensureLocalWorkspace(db: LibsqlDb): Promise<{ workspaceId: string; projectId: string }> {
  await ensureLocalUser(db);
  const mem = await db
    .prepare(`SELECT workspace_id FROM workspace_members WHERE user_id = ? LIMIT 1`)
    .bind(LOCAL_USER_ID)
    .first<{ workspace_id: string }>();
  let workspaceId = mem?.workspace_id;
  const ts = nowIso();
  if (!workspaceId) {
    workspaceId = newId('ws');
    await db.batch([
      db
        .prepare(
          `INSERT INTO workspaces (id, name, slug, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(workspaceId, 'Local workspace', 'local', LOCAL_USER_ID, ts, ts),
      db
        .prepare(
          `INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)`,
        )
        .bind(workspaceId, LOCAL_USER_ID, ts),
    ]);
  }
  const proj = await db
    .prepare(`SELECT id FROM projects WHERE workspace_id = ? ORDER BY created_at LIMIT 1`)
    .bind(workspaceId)
    .first<{ id: string }>();
  if (proj) return { workspaceId, projectId: proj.id };
  const projectId = newId('proj');
  await db.batch([
    db
      .prepare(
        `INSERT INTO projects (id, workspace_id, name, slug, description, trust_mode, embeddings_enabled, graft_enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'review', 0, 0, ?, ?)`,
      )
      .bind(projectId, workspaceId, 'Local project', 'local', 'Default local project', ts, ts),
    db
      .prepare(
        `INSERT INTO project_members (project_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)`,
      )
      .bind(projectId, LOCAL_USER_ID, ts),
  ]);
  return { workspaceId, projectId };
}

export function hashPassword(password: string): string {
  return createHash('sha256').update(`driftless:local:${password}`).digest('hex');
}

export async function writeConfigMeta(cfg: LocalConfig): Promise<void> {
  const meta = {
    version: 1,
    createdAt: nowIso(),
    passwordHash: cfg.password ? hashPassword(cfg.password) : null,
  };
  await writeFile(cfg.configPath, JSON.stringify(meta, null, 2));
}

export async function readPasswordHash(cfg: LocalConfig): Promise<string | undefined> {
  try {
    await access(cfg.configPath);
    const raw = JSON.parse(await readFile(cfg.configPath, 'utf8')) as { passwordHash?: string | null };
    return raw.passwordHash || undefined;
  } catch {
    return cfg.password ? hashPassword(cfg.password) : undefined;
  }
}

export async function createLocalEnv(
  cfg: LocalConfig,
  migrationsDir: string,
): Promise<{ env: Env; db: LibsqlDb; projectId: string; workspaceId: string }> {
  await ensureDataDir(cfg);
  const db = openLibsql(cfg.dbPath);
  await applyMigrations(db, migrationsDir);
  const { workspaceId, projectId } = await ensureLocalWorkspace(db);
  const docs = new FsDocsBucket(cfg.docsDir);
  const passwordHash = await readPasswordHash(cfg);

  const envHolder: { env: Env } = { env: null as unknown as Env };
  const jobs = createLocalQueue(() => envHolder.env);
  const env: Env = {
    DB: db,
    DOCS: docs,
    JOBS: jobs,
    APP_NAME: 'Driftless',
    APP_BASE_URL: `http://127.0.0.1:${cfg.port}`,
    SESSION_SECRET: 'local-dev-secret',
    LOCAL_MODE: true,
    LOCAL_PASSWORD_HASH: passwordHash,
    LOCAL_DATA_DIR: cfg.dataDir,
  };
  envHolder.env = env;
  return { env, db, projectId, workspaceId };
}

export async function createLocalSession(env: Env): Promise<string> {
  const token = newToken(24);
  const hash = await hashToken(token);
  const ts = nowIso();
  const expires = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(newId('sess'), LOCAL_USER_ID, hash, expires, ts)
    .run();
  return token;
}
