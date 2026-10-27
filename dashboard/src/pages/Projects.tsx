import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type Project } from '../lib/api';

export default function Projects({
  projects,
  onChange,
}: {
  projects: Project[];
  onChange: () => Promise<void> | void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const nav = useNavigate();

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError('');
    try {
      const created = await api<{ id: string }>('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ name: trimmed }),
      });
      setName('');
      await onChange();
      nav(`/projects/${created.id}/docs`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create project');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1>Projects</h1>
      <p className="muted">
        A project groups several repos as one system. A default workspace is created for you
        automatically.
      </p>
      <div className="card" style={{ margin: '1rem 0' }}>
        <div className="row">
          <input
            placeholder="New project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') create();
            }}
            style={{ maxWidth: 320 }}
          />
          <button className="primary" disabled={!name.trim() || busy} onClick={create}>
            {busy ? 'Creating…' : 'Create project'}
          </button>
        </div>
        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      </div>
      {projects.length === 0 ? (
        <div className="card muted">No projects yet — create one above to open Docs, Review, Drift, Graph, and Settings.</div>
      ) : (
        <div className="cards">
          {projects.map((p) => (
            <Link
              key={p.id}
              to={`/projects/${p.id}/docs`}
              className="card"
              style={{ color: 'inherit' }}
            >
              <h3>{p.name}</h3>
              <div className="muted">{p.description || p.slug}</div>
              <div style={{ marginTop: '0.5rem' }}>
                <span className="badge">trust: {p.trust_mode}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
