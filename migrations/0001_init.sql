-- Driftless initial schema

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  github_id TEXT NOT NULL UNIQUE,
  login TEXT NOT NULL,
  name TEXT,
  email TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  trust_mode TEXT NOT NULL DEFAULT 'review' CHECK (trust_mode IN ('review', 'auto', 'trust')),
  embeddings_enabled INTEGER NOT NULL DEFAULT 0,
  graft_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (workspace_id, slug)
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS repos (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  github_owner TEXT NOT NULL,
  github_name TEXT NOT NULL,
  default_branch TEXT NOT NULL DEFAULT 'main',
  webhook_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (project_id, github_owner, github_name)
);

CREATE TABLE IF NOT EXISTS docs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  repo_id TEXT REFERENCES repos(id) ON DELETE SET NULL,
  path TEXT NOT NULL,
  title TEXT NOT NULL,
  covered_paths TEXT NOT NULL DEFAULT '[]', -- JSON array of glob/path patterns
  covered_names TEXT NOT NULL DEFAULT '[]', -- JSON array of symbol/endpoint names
  current_version INTEGER NOT NULL DEFAULT 1,
  drift_status TEXT NOT NULL DEFAULT 'ok' CHECK (drift_status IN ('ok', 'stale', 'review')),
  created_by TEXT REFERENCES users(id),
  updated_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (project_id, path)
);

CREATE TABLE IF NOT EXISTS doc_versions (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  author_id TEXT REFERENCES users(id),
  author_type TEXT NOT NULL DEFAULT 'user' CHECK (author_type IN ('user', 'agent', 'system')),
  summary TEXT,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (doc_id, version)
);

CREATE TABLE IF NOT EXISTS drift_flags (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  repo_id TEXT REFERENCES repos(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  match_type TEXT NOT NULL CHECK (match_type IN ('path', 'name', 'graft', 'manual')),
  changed_paths TEXT NOT NULL DEFAULT '[]',
  changed_names TEXT NOT NULL DEFAULT '[]',
  commit_sha TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'resolved')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved_at TEXT,
  resolved_by TEXT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS review_items (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  doc_id TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  proposed_content TEXT NOT NULL,
  base_version INTEGER NOT NULL,
  summary TEXT,
  source TEXT NOT NULL DEFAULT 'agent' CHECK (source IN ('agent', 'auto', 'system')),
  author_id TEXT REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  decided_at TEXT,
  decided_by TEXT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  permission TEXT NOT NULL CHECK (permission IN ('read', 'write')),
  project_ids TEXT NOT NULL DEFAULT '[]', -- JSON array; empty = all user projects
  last_used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS share_links (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  doc_id TEXT REFERENCES docs(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  redirect_to TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS embedding_jobs (
  doc_id TEXT PRIMARY KEY REFERENCES docs(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed'))
);

-- FTS5 keyword index over docs (title + body excerpt maintained by app)
CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
  doc_id UNINDEXED,
  project_id UNINDEXED,
  title,
  body,
  names,
  tokenize = 'porter unicode61'
);

CREATE INDEX IF NOT EXISTS idx_docs_project ON docs(project_id);
CREATE INDEX IF NOT EXISTS idx_docs_drift ON docs(project_id, drift_status);
CREATE INDEX IF NOT EXISTS idx_drift_flags_open ON drift_flags(project_id, status);
CREATE INDEX IF NOT EXISTS idx_review_pending ON review_items(project_id, status);
CREATE INDEX IF NOT EXISTS idx_repos_project ON repos(project_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_share_expires ON share_links(expires_at);
