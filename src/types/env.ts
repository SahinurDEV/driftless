/** Minimal D1-like prepared statement used by app code. */
export interface DbStatement {
  bind(...values: unknown[]): DbStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean; meta?: { changes?: number } }>;
}

export interface DbAdapter {
  prepare(query: string): DbStatement;
  batch(statements: DbStatement[]): Promise<unknown[]>;
}

/** Minimal R2-like object store used by app code. */
export interface DocsObject {
  text(): Promise<string>;
  key?: string;
}

export interface DocsBucket {
  get(key: string): Promise<DocsObject | null>;
  put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView | ReadableStream,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown>;
  list(options?: { prefix?: string; limit?: number }): Promise<{ objects: { key: string }[] }>;
}

export interface JobsQueue {
  send(message: QueueMessage): Promise<void>;
}

export interface Env {
  /** D1 in Cloudflare; LibsqlDb shim locally — both satisfy DbAdapter. */
  DB: DbAdapter;
  /** R2 in Cloudflare; filesystem shim locally. */
  DOCS: DocsBucket;
  /** Queues in Cloudflare; in-process locally. */
  JOBS: JobsQueue;
  ASSETS?: Fetcher;
  VECTORIZE?: VectorizeIndex;
  AI?: Ai;
  APP_NAME: string;
  APP_BASE_URL?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
  WEBHOOK_SECRET?: string;
  /** Set in local Node mode */
  LOCAL_MODE?: boolean;
  LOCAL_PASSWORD_HASH?: string;
  LOCAL_DATA_DIR?: string;
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
