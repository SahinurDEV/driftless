import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FilePlus2, History, Sparkles, Undo2 } from 'lucide-react';
import { api } from '../lib/api';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import { SkeletonLines } from '../components/Skeleton';

type DocRow = {
  id: string;
  path: string;
  title: string;
  current_version: number;
  drift_status: string;
};

type VersionRow = {
  id: string;
  version: number;
  summary: string | null;
  author_type: string;
  created_at: string;
};

export default function DocsPage() {
  const { projectId, docId } = useParams();
  const nav = useNavigate();
  const [docs, setDocs] = useState<DocRow[] | null>(null);
  const [q, setQ] = useState('');
  const [content, setContent] = useState('');
  const [meta, setMeta] = useState<DocRow | null>(null);
  const [version, setVersion] = useState(1);
  const [newPath, setNewPath] = useState('features/example.md');
  const [msg, setMsg] = useState('');
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [diff, setDiff] = useState('');
  const [showHistory, setShowHistory] = useState(false);

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
      setVersions([]);
      return;
    }
    api<{ doc: DocRow; content: string }>(`/api/projects/${projectId}/docs/${docId}`).then((r) => {
      setMeta(r.doc);
      setContent(r.content ?? '');
      setVersion(r.doc.current_version);
    });
    api<{ versions: VersionRow[] }>(`/api/projects/${projectId}/docs/${docId}/versions`).then((r) => {
      setVersions(r.versions || []);
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
        const vr = await api<{ versions: VersionRow[] }>(
          `/api/projects/${projectId}/docs/${docId}/versions`,
        );
        setVersions(vr.versions || []);
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

  async function generateFromCode() {
    if (!projectId) return;
    setMsg('Generating from code…');
    try {
      const r = await api<{ id: string; path?: string }>(`/api/projects/${projectId}/docs/generate`, {
        method: 'POST',
        body: JSON.stringify({ use_ollama: false }),
      });
      setMsg('Generated starter doc');
      nav(`/projects/${projectId}/docs/${r.id}`);
      refreshList();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Generate failed');
    }
  }

  async function showDiff(from: number, to: number) {
    const r = await api<{ diff: string }>(
      `/api/projects/${projectId}/docs/${docId}/diff?from=${from}&to=${to}`,
    );
    setDiff(r.diff);
    setShowHistory(true);
  }

  async function rollback(toVersion: number) {
    if (!confirm(`Roll back to v${toVersion}? This creates a new version.`)) return;
    const r = await api<{ version: number }>(`/api/projects/${projectId}/docs/${docId}/rollback`, {
      method: 'POST',
      body: JSON.stringify({ to_version: toVersion }),
    });
    setMsg(`Rolled back — now v${r.version}`);
    const full = await api<{ doc: DocRow; content: string }>(
      `/api/projects/${projectId}/docs/${docId}`,
    );
    setMeta(full.doc);
    setContent(full.content ?? '');
    setVersion(full.doc.current_version);
    const vr = await api<{ versions: VersionRow[] }>(
      `/api/projects/${projectId}/docs/${docId}/versions`,
    );
    setVersions(vr.versions || []);
    refreshList();
  }

  return (
    <div className="split">
      <div>
        <div className="row" style={{ marginBottom: '0.75rem' }}>
          <input placeholder="Search docs…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="card" style={{ marginBottom: '0.75rem' }}>
          <div className="row">
            <input value={newPath} onChange={(e) => setNewPath(e.target.value)} />
            <button className="primary" onClick={createDoc}>
              <FilePlus2 size={16} /> New
            </button>
            <button onClick={generateFromCode} title="Scan a local repo and create a starter doc">
              <Sparkles size={16} /> From code
            </button>
          </div>
        </div>
        {docs === null ? (
          <SkeletonLines lines={6} />
        ) : !docs.length ? (
          <EmptyState
            title="No docs yet"
            description="Create a markdown doc or generate one from your local repo."
            action={
              <button className="primary" onClick={generateFromCode}>
                <Sparkles size={16} /> Generate from code
              </button>
            }
          />
        ) : (
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
                    <StatusBadge status={d.drift_status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div>
        {meta ? (
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ margin: 0 }}>{meta.title}</h3>
                <div className="muted">
                  v{version} · <StatusBadge status={meta.drift_status} />
                </div>
              </div>
              <div className="row">
                <button onClick={() => setShowHistory((s) => !s)}>
                  <History size={16} /> History
                </button>
                <button className="primary" onClick={save}>
                  Save
                </button>
              </div>
            </div>
            {msg && <p className="muted">{msg}</p>}
            {showHistory && (
              <div style={{ marginBottom: '0.75rem' }}>
                <h4>Version history</h4>
                <table className="table">
                  <tbody>
                    {versions.map((v) => (
                      <tr key={v.id}>
                        <td>
                          v{v.version}{' '}
                          <span className="muted">{v.summary || v.author_type}</span>
                          <div className="muted" style={{ fontSize: '0.75rem' }}>
                            {new Date(v.created_at).toLocaleString()}
                          </div>
                        </td>
                        <td>
                          <div className="row">
                            {v.version < version && (
                              <button onClick={() => showDiff(v.version, version)}>Diff</button>
                            )}
                            {v.version !== version && (
                              <button onClick={() => rollback(v.version)}>
                                <Undo2 size={14} /> Rollback
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {diff && (
                  <pre className="diff-view">
                    {diff.split('\n').map((line, i) => (
                      <div
                        key={i}
                        className={line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : ''}
                      >
                        {line}
                      </div>
                    ))}
                  </pre>
                )}
              </div>
            )}
            <textarea value={content} onChange={(e) => setContent(e.target.value)} />
          </div>
        ) : (
          <EmptyState title="Select or create a doc" description="Pick a doc on the left, or generate one from code." />
        )}
      </div>
    </div>
  );
}
