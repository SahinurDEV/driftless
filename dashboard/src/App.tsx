import { Link, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api, type Project, type User } from './lib/api';
import Home from './pages/Home';
import Projects from './pages/Projects';
import ProjectLayout from './pages/ProjectLayout';
import DocsPage from './pages/DocsPage';
import ReviewPage from './pages/ReviewPage';
import DriftPage from './pages/DriftPage';
import GraphPage from './pages/GraphPage';
import SettingsPage from './pages/SettingsPage';
import Login from './pages/Login';

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [projects, setProjects] = useState<Project[]>([]);
  const loc = useLocation();

  useEffect(() => {
    api<{ user: User | null }>('/api/me')
      .then((r) => setUser(r.user))
      .catch(() => setUser(null));
  }, [loc.pathname]);

  useEffect(() => {
    if (!user) return;
    api<{ projects: Project[] }>('/api/projects')
      .then((r) => setProjects(r.projects))
      .catch(() => setProjects([]));
  }, [user]);

  if (user === undefined) {
    return <div className="main muted">Loading…</div>;
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <span /> Driftless
        </div>
        <nav className="nav">
          <NavLink to="/">Home</NavLink>
          <NavLink to="/projects">Projects</NavLink>
          {projects.slice(0, 8).map((p) => (
            <NavLink key={p.id} to={`/projects/${p.id}/docs`}>
              {p.name}
            </NavLink>
          ))}
        </nav>
        <div style={{ marginTop: 'auto' }} className="muted">
          <div className="row" style={{ marginBottom: '0.5rem' }}>
            {user.avatar_url && (
              <img
                src={user.avatar_url}
                alt=""
                width={28}
                height={28}
                style={{ borderRadius: '50%' }}
              />
            )}
            <span>@{user.login}</span>
          </div>
          <a href="/oauth/logout">Sign out</a>
        </div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<Home user={user} projects={projects} />} />
          <Route path="/projects" element={<Projects projects={projects} onChange={() => {
            api<{ projects: Project[] }>('/api/projects').then((r) => setProjects(r.projects));
          }} />} />
          <Route path="/projects/:projectId" element={<ProjectLayout />}>
            <Route index element={<Navigate to="docs" replace />} />
            <Route path="docs" element={<DocsPage />} />
            <Route path="docs/:docId" element={<DocsPage />} />
            <Route path="review" element={<ReviewPage />} />
            <Route path="drift" element={<DriftPage />} />
            <Route path="graph" element={<GraphPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  const loc = useLocation();
  const active = loc.pathname === to || (to !== '/' && loc.pathname.startsWith(to));
  return (
    <Link to={to} className={active ? 'active' : ''}>
      {children}
    </Link>
  );
}

// silence unused
void useParams;
