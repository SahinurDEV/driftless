import { Link } from 'react-router-dom';
import { FolderKanban, LayoutDashboard } from 'lucide-react';
import type { Project, User } from '../lib/api';
import EmptyState from '../components/EmptyState';

export default function Home({ user, projects }: { user: User; projects: Project[] }) {
  return (
    <div>
      <h1>Welcome, {user.name || user.login}</h1>
      <p className="muted">Your shared living docs workspace — light, clear, and in sync with code.</p>
      <div className="row" style={{ marginTop: '1rem' }}>
        <Link className="btn" to="/overview">
          <LayoutDashboard size={16} /> Multi-repo overview
        </Link>
        <Link className="btn primary" to="/projects">
          <FolderKanban size={16} /> Projects
        </Link>
      </div>
      <div className="cards" style={{ marginTop: '1.5rem' }}>
        {projects.map((p) => (
          <Link key={p.id} to={`/projects/${p.id}/docs`} className="card" style={{ color: 'inherit' }}>
            <h3>{p.name}</h3>
            <div className="muted">{p.slug}</div>
            <div style={{ marginTop: '0.5rem' }}>
              <span className="badge">trust: {p.trust_mode}</span>
            </div>
          </Link>
        ))}
        {!projects.length && (
          <EmptyState
            title="Get started"
            description="Create your first project to browse docs, review edits, watch drift, and manage API keys."
            action={<Link className="btn primary" to="/projects">Create a project →</Link>}
          />
        )}
      </div>
    </div>
  );
}
