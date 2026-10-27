import { Link, NavLink, Outlet, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api, type Project } from '../lib/api';

export default function ProjectLayout() {
  const { projectId } = useParams();
  const [project, setProject] = useState<Project | null>(null);

  useEffect(() => {
    if (!projectId) return;
    api<{ project: Project }>(`/api/projects/${projectId}`).then((r) => setProject(r.project));
  }, [projectId]);

  if (!project) return <div className="muted">Loading project…</div>;

  const base = `/projects/${projectId}`;
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: '1rem' }}>
        <div>
          <div className="muted" style={{ fontSize: '0.85rem' }}>
            <Link to="/projects">Projects</Link> / {project.slug}
          </div>
          <h1 style={{ margin: '0.2rem 0' }}>{project.name}</h1>
        </div>
        <span className="badge">trust: {project.trust_mode}</span>
      </div>
      <nav className="row" style={{ marginBottom: '1.25rem', gap: '0.35rem' }}>
        {[
          ['docs', 'Docs'],
          ['review', 'Review'],
          ['drift', 'Drift'],
          ['graph', 'Graph'],
          ['settings', 'Settings'],
        ].map(([path, label]) => (
          <NavLink
            key={path}
            to={`${base}/${path}`}
            className={({ isActive }) => `btn${isActive ? ' primary' : ''}`}
            style={{ textDecoration: 'none' }}
          >
            {label}
          </NavLink>
        ))}
      </nav>
      <Outlet context={{ project }} />
    </div>
  );
}
