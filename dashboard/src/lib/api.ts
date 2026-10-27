export async function api<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || res.statusText);
  }
  return data as T;
}

export type User = {
  id: string;
  login: string;
  name?: string;
  avatar_url?: string;
};

export type Project = {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  description?: string;
  trust_mode: 'review' | 'auto' | 'trust';
  embeddings_enabled: number;
  graft_enabled: number;
  my_role?: string;
};
