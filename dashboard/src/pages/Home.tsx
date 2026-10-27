import { Link } from 'react-router-dom';
import type { Project, User } from '../lib/api';

export default function Home({ user, projects }: { user: User; projects: Project[] }) {
  return (
    <div>
      <h1>Welcome, {user.name || user.login}</h1>
      <p className="muted">Your shared living docs workspace.</p>
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
          <div className="card">
            <h3>Get started</h3>
            <p className="muted">
              A default workspace is ready. Create your first project to browse docs, review AI
              edits, watch drift, and manage API keys.
            </p>
            <Link to="/projects">Create a project →</Link>
          </div>
        )}
      </div>
    </div>
  );
}
