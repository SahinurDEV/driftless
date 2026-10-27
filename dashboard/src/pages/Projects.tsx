import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Project } from '../lib/api';

export default function Projects({
  projects,
  onChange,
}: {
  projects: Project[];
  onChange: () => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function create() {
    setBusy(true);
    setError('');
    try {
      let workspaces = await api<{ workspaces: { id: string }[] }>('/api/workspaces');
      let wsId = workspaces.workspaces[0]?.id;
      if (!wsId) {
        const ws = await api<{ id: string }>('/api/workspaces', {
          method: 'POST',
          body: JSON.stringify({ name: 'My workspace' }),
        });
        wsId = ws.id;
      }
      await api(`/api/workspaces/${wsId}/projects`, {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      setName('');
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1>Projects</h1>
      <p className="muted">A project groups several repos treated as one system.</p>
      <div className="card" style={{ margin: '1rem 0' }}>
        <div className="row">
          <input
            placeholder="New project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ maxWidth: 320 }}
          />
          <button className="primary" disabled={!name.trim() || busy} onClick={create}>
            Create
          </button>
        </div>
        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      </div>
      <div className="cards">
        {projects.map((p) => (
          <Link key={p.id} to={`/projects/${p.id}/docs`} className="card" style={{ color: 'inherit' }}>
            <h3>{p.name}</h3>
            <div className="muted">{p.description || p.slug}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
