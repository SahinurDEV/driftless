import { Link, NavLink, Outlet, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api, type Project } from '../lib/api';
import { SkeletonLines } from '../components/Skeleton';

export default function ProjectLayout() {
  const { projectId } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!projectId) return;
    setProject(null);
    setError('');
    api<{ project: Project }>(`/api/projects/${projectId}`)
      .then((r) => setProject(r.project))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load project'));
  }, [projectId]);

  if (error) {
    return (
      <div className="card">
        <h2>Couldn’t open project</h2>
        <p style={{ color: 'var(--danger)' }}>{error}</p>
        <Link to="/projects">Back to projects</Link>
      </div>
    );
  }

  if (!project) return <SkeletonLines lines={4} />;

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
      <nav className="row project-tabs" style={{ marginBottom: '1.25rem', gap: '0.35rem' }}>
        {[
          ['docs', 'Docs'],
          ['search', 'Search'],
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
