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
            <h3>No projects yet</h3>
            <p className="muted">Create a workspace and project to start.</p>
            <Link to="/projects">Go to projects →</Link>
          </div>
        )}
      </div>
    </div>
  );
}
