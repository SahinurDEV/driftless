import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, type Project } from '../lib/api';

export default function SettingsPage() {
  const { projectId } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [repos, setRepos] = useState<
    { id: string; github_owner: string; github_name: string; local_path?: string | null }[]
  >([]);
  const [owner, setOwner] = useState('');
  const [name, setName] = useState('');
  const [localPath, setLocalPath] = useState('');
  const [mode, setMode] = useState<'cloud' | 'local'>('cloud');
  const [keys, setKeys] = useState<unknown[]>([]);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [toast, setToast] = useState('');
  const [exportName, setExportName] = useState('');

  async function load() {
    const r = await api<{ project: Project; repos: typeof repos }>(`/api/projects/${projectId}`);
    setProject(r.project);
    setRepos(r.repos);
    const k = await api<{ keys: unknown[] }>('/api/keys');
    setKeys(k.keys);
  }

  useEffect(() => {
    load().catch(console.error);
    fetch('/api/health')
      .then((r) => r.json())
      .then((h: { mode?: string }) => setMode(h.mode === 'local' ? 'local' : 'cloud'))
      .catch(() => {});
  }, [projectId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  async function saveProject(patch: Record<string, unknown>) {
    await api(`/api/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    setMsg('Saved');
    await load();
  }

  async function addRepo() {
    if (mode === 'local' && localPath.trim()) {
      await api(`/api/projects/${projectId}/repos`, {
        method: 'POST',
        body: JSON.stringify({ local_path: localPath.trim() }),
      });
      setLocalPath('');
    } else {
      await api(`/api/projects/${projectId}/repos`, {
        method: 'POST',
        body: JSON.stringify({ github_owner: owner, github_name: name }),
      });
      setOwner('');
      setName('');
    }
    await load();
  }

  async function createKey() {
    const r = await api<{ key: string }>('/api/keys', {
      method: 'POST',
      body: JSON.stringify({
        name: 'MCP key',
        permission: 'write',
        project_ids: projectId ? [projectId] : [],
      }),
    });
    setNewKey(r.key);
    await load();
  }

  async function createShare() {
    // Prefer sharing the first doc for a nicer preview page
    let docId: string | undefined;
    try {
      const docs = await api<{ docs: { id: string }[] }>(`/api/projects/${projectId}/docs`);
      docId = docs.docs[0]?.id;
    } catch {
      /* project share */
    }
    const r = await api<{ token: string; url_path: string }>(`/api/projects/${projectId}/share`, {
      method: 'POST',
      body: JSON.stringify({ expires_in_hours: 72, doc_id: docId }),
    });
    const url = `${window.location.origin}${r.url_path}`;
    setShareUrl(url);
    setToast('Share link created');
  }

  async function exportMd() {
    setToast('Preparing export…');
    const r = await api<{ files: { path: string; content: string }[] }>(
      `/api/projects/${projectId}/export`,
    );
    const slug = project?.slug || projectId || 'project';
    const filename = `driftless-export-${slug}.md`;
    const blob = new Blob(
      [
        `# Driftless export — ${project?.name || slug}\n\n` +
          r.files.map((f) => `---\nFILE: ${f.path}\n---\n${f.content}`).join('\n\n'),
      ],
      { type: 'text/markdown;charset=utf-8' },
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    setExportName(filename);
    setToast(`Downloaded ${filename}`);
  }

  if (!project) return <div className="muted">Loading…</div>;

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      {toast && <div className="toast">{toast}</div>}
      <div className="card">
        <h3>Trust mode</h3>
        <select
          value={project.trust_mode}
          onChange={(e) => saveProject({ trust_mode: e.target.value as Project['trust_mode'] })}
          style={{ maxWidth: 240 }}
        >
          <option value="review">Review — every AI edit needs approval</option>
          <option value="auto">Auto — small fixes apply, big ones review</option>
          <option value="trust">Trust — AI applies all, changelog kept</option>
        </select>
        <div className="row" style={{ marginTop: '0.75rem' }}>
          <label className="row">
            <input
              type="checkbox"
              checked={!!project.embeddings_enabled}
              onChange={(e) => saveProject({ embeddings_enabled: e.target.checked })}
              style={{ width: 'auto' }}
            />
            Semantic search (Vectorize + Workers AI)
          </label>
          <label className="row">
            <input
              type="checkbox"
              checked={!!project.graft_enabled}
              onChange={(e) => saveProject({ graft_enabled: e.target.checked })}
              style={{ width: 'auto' }}
            />
            Graft code graph
          </label>
        </div>
        {msg && <p className="muted">{msg}</p>}
      </div>

      <div className="card">
        <h3>{mode === 'local' ? 'Local folders / repos' : 'GitHub repos'}</h3>
        <ul>
          {repos.map((r) => (
            <li key={r.id}>
              {r.local_path ? (
                <>
                  <code>{r.local_path}</code>
                </>
              ) : (
                <>
                  {r.github_owner}/{r.github_name}
                </>
              )}
            </li>
          ))}
        </ul>
        {mode === 'local' ? (
          <div className="row">
            <input
              placeholder="/absolute/path/to/repo"
              value={localPath}
              onChange={(e) => setLocalPath(e.target.value)}
              style={{ maxWidth: 360 }}
            />
            <button onClick={addRepo}>Add folder</button>
          </div>
        ) : (
          <div className="row">
            <input
              placeholder="owner"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              style={{ maxWidth: 160 }}
            />
            <input
              placeholder="repo"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ maxWidth: 160 }}
            />
            <button onClick={addRepo}>Connect</button>
          </div>
        )}
        <p className="muted" style={{ marginTop: '0.5rem' }}>
          {mode === 'local'
            ? 'Changes are watched on disk (and optional git post-commit hook). No GitHub webhook needed.'
            : 'Point a GitHub webhook to /webhook/github with your WEBHOOK_SECRET.'}
        </p>
      </div>

      <div className="card">
        <h3>API keys (MCP)</h3>
        <button className="primary" onClick={createKey}>
          Create write key for this project
        </button>
        {newKey && (
          <p>
            Copy now: <code>{newKey}</code>
          </p>
        )}
        <pre className="muted" style={{ fontSize: '0.8rem' }}>
          {JSON.stringify(keys, null, 2)}
        </pre>
      </div>

      <div className="card">
        <h3>Share & export</h3>
        <div className="row">
          <button onClick={createShare}>Create 72h share link</button>
          <button onClick={exportMd}>Export markdown</button>
        </div>
        {shareUrl && (
          <p>
            Share URL: <a href={shareUrl}>{shareUrl}</a>
          </p>
        )}
        {exportName && (
          <p className="muted" data-testid="export-filename">
            Last download: <strong>{exportName}</strong>
          </p>
        )}
      </div>
    </div>
  );
}
