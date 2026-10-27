import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';

type DocRow = {
  id: string;
  path: string;
  title: string;
  current_version: number;
  drift_status: string;
};

export default function DocsPage() {
  const { projectId, docId } = useParams();
  const nav = useNavigate();
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [q, setQ] = useState('');
  const [content, setContent] = useState('');
  const [meta, setMeta] = useState<DocRow | null>(null);
  const [version, setVersion] = useState(1);
  const [newPath, setNewPath] = useState('features/example.md');
  const [msg, setMsg] = useState('');

  async function refreshList() {
    if (!projectId) return;
    if (q.trim()) {
      const r = await api<{ results: { doc_id: string; title: string; snippet: string }[] }>(
        `/api/projects/${projectId}/docs?q=${encodeURIComponent(q)}`,
      );
      setDocs(
        r.results.map((x) => ({
          id: x.doc_id,
          path: x.title,
          title: x.title,
          current_version: 0,
          drift_status: 'ok',
        })),
      );
    } else {
      const r = await api<{ docs: DocRow[] }>(`/api/projects/${projectId}/docs`);
      setDocs(r.docs);
    }
  }

  useEffect(() => {
    refreshList().catch(console.error);
  }, [projectId, q]);

  useEffect(() => {
    if (!projectId || !docId) {
      setMeta(null);
      setContent('');
      return;
    }
    api<{ doc: DocRow; content: string }>(`/api/projects/${projectId}/docs/${docId}`).then((r) => {
      setMeta(r.doc);
      setContent(r.content ?? '');
      setVersion(r.doc.current_version);
    });
  }, [projectId, docId]);

  async function save() {
    if (!projectId || !docId) return;
    setMsg('');
    try {
      const r = await api<{ saved?: boolean; version?: number; queued?: boolean; error?: string }>(
        `/api/projects/${projectId}/docs/${docId}`,
        {
          method: 'PUT',
          body: JSON.stringify({ content, base_version: version }),
        },
      );
      if (r.queued) setMsg('Queued for review (trust mode)');
      else {
        setMsg(`Saved v${r.version}`);
        setVersion(r.version!);
        refreshList();
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Save failed');
    }
  }

  async function createDoc() {
    if (!projectId) return;
    const template = `---
title: ${newPath.split('/').pop()?.replace(/\.md$/, '') || 'Doc'}
covered_paths: []
covered_names: []
---
# Overview

Describe the feature here.
`;
    const r = await api<{ id: string }>(`/api/projects/${projectId}/docs`, {
      method: 'POST',
      body: JSON.stringify({ path: newPath, content: template }),
    });
    nav(`/projects/${projectId}/docs/${r.id}`);
    refreshList();
  }

  return (
    <div className="split">
      <div>
        <div className="row" style={{ marginBottom: '0.75rem' }}>
          <input
            placeholder="Search docs…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="card" style={{ marginBottom: '0.75rem' }}>
          <div className="row">
            <input value={newPath} onChange={(e) => setNewPath(e.target.value)} />
            <button className="primary" onClick={createDoc}>
              New
            </button>
          </div>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Doc</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td>
                  <Link to={`/projects/${projectId}/docs/${d.id}`}>{d.title}</Link>
                  <div className="muted" style={{ fontSize: '0.8rem', fontFamily: 'var(--mono)' }}>
                    {d.path}
                  </div>
                </td>
                <td>
                  <span className={`badge ${d.drift_status}`}>{d.drift_status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        {meta ? (
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ margin: 0 }}>{meta.title}</h3>
                <div className="muted">v{version}</div>
              </div>
              <button className="primary" onClick={save}>
                Save
              </button>
            </div>
            {msg && <p className="muted">{msg}</p>}
            <textarea value={content} onChange={(e) => setContent(e.target.value)} />
          </div>
        ) : (
          <div className="card muted">Select or create a doc.</div>
        )}
      </div>
    </div>
  );
}
