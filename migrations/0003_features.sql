-- Notifications, team drift, local team users, code FTS, project settings

ALTER TABLE projects ADD COLUMN notify_webhook_url TEXT;
ALTER TABLE projects ADD COLUMN notify_webhook_type TEXT DEFAULT 'slack';

ALTER TABLE drift_flags ADD COLUMN assignee TEXT;
ALTER TABLE drift_flags ADD COLUMN assignee_name TEXT;

CREATE TABLE IF NOT EXISTS drift_comments (
  id TEXT PRIMARY KEY,
  flag_id TEXT NOT NULL REFERENCES drift_flags(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES users(id),
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_drift_comments_flag ON drift_comments(flag_id);

CREATE TABLE IF NOT EXISTS local_team (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (project_id, name)
);

CREATE VIRTUAL TABLE IF NOT EXISTS code_fts USING fts5(
  project_id UNINDEXED,
  repo_id UNINDEXED,
  path,
  body,
  tokenize = 'porter unicode61'
);

CREATE TABLE IF NOT EXISTS code_files (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  indexed_at TEXT NOT NULL,
  UNIQUE (project_id, repo_id, path)
);

CREATE INDEX IF NOT EXISTS idx_code_files_repo ON code_files(project_id, repo_id);
