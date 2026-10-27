export interface Env {
  DB: D1Database;
  DOCS: R2Bucket;
  JOBS: Queue<QueueMessage>;
  ASSETS?: Fetcher;
  VECTORIZE?: VectorizeIndex;
  AI?: Ai;
  APP_NAME: string;
  APP_BASE_URL?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
  WEBHOOK_SECRET?: string;
}

export type TrustMode = 'review' | 'auto' | 'trust';
export type Role = 'owner' | 'editor' | 'viewer';
export type ApiKeyPermission = 'read' | 'write';
export type DriftStatus = 'ok' | 'stale' | 'review';
export type DriftMatchType = 'path' | 'name' | 'graft' | 'manual';
export type AuthorType = 'user' | 'agent' | 'system';

export interface QueueMessage {
  type: 'drift_check' | 'embed_doc' | 'reindex_doc';
  projectId: string;
  repoId?: string;
  commitSha?: string;
  changedPaths?: string[];
  changedNames?: string[];
  docId?: string;
  graftEnabled?: boolean;
}

export interface DocFrontmatter {
  title?: string;
  covered_paths?: string[];
  covered_names?: string[];
}

export interface DocRecord {
  id: string;
  project_id: string;
  repo_id: string | null;
  path: string;
  title: string;
  covered_paths: string;
  covered_names: string;
  current_version: number;
  drift_status: DriftStatus;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectRecord {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  description: string | null;
  trust_mode: TrustMode;
  embeddings_enabled: number;
  graft_enabled: number;
  created_at: string;
  updated_at: string;
}

export interface AuthContext {
  userId: string;
  login: string;
  via: 'session' | 'api_key';
  apiKeyId?: string;
  permission: ApiKeyPermission | 'session';
  projectIds?: string[];
}
