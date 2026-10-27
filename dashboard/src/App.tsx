import { Link, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import NotFound from './pages/NotFound';

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [projects, setProjects] = useState<Project[]>([]);
  const [bootError, setBootError] = useState('');
  const loc = useLocation();

  const refreshProjects = useCallback(async () => {
    const r = await api<{ projects: Project[] }>('/api/projects');
    setProjects(r.projects);
  }, []);

  // Bootstrap once — do not re-hit /api/me on every navigation
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await api<{ user: User | null }>('/api/me');
        if (cancelled) return;
        setUser(me.user);
        if (me.user) {
          try {
            await refreshProjects();
          } catch {
            setProjects([]);
          }
        }
      } catch {
        if (!cancelled) {
          setUser(null);
          setBootError('Could not reach the API');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshProjects]);

  const activeProjectId = useMemo(() => {
    const m = loc.pathname.match(/^\/projects\/([^/]+)/);
    return m?.[1] && m[1] !== 'new' ? m[1] : null;
  }, [loc.pathname]);

  const activeProject = projects.find((p) => p.id === activeProjectId) || null;

  if (user === undefined) {
    return (
      <div className="boot">
        <img src="/logo-mark.svg" alt="" width={40} height={40} />
        <div className="muted">Starting Driftless…</div>
      </div>
    );
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
        <Link to="/" className="brand" style={{ color: 'inherit', textDecoration: 'none' }}>
          <img src="/logo-mark.svg" alt="" width={28} height={28} />
          <span className="brand-word">Driftless</span>
        </Link>
        <nav className="nav">
          <SideLink to="/">Home</SideLink>
          <SideLink to="/projects">Projects</SideLink>
          {activeProject && (
            <div className="nav-section">
              <div className="nav-section-label">{activeProject.name}</div>
              <SideLink to={`/projects/${activeProject.id}/docs`}>Docs</SideLink>
              <SideLink to={`/projects/${activeProject.id}/review`}>Review</SideLink>
              <SideLink to={`/projects/${activeProject.id}/drift`}>Drift</SideLink>
              <SideLink to={`/projects/${activeProject.id}/graph`}>Graph</SideLink>
              <SideLink to={`/projects/${activeProject.id}/settings`}>Settings</SideLink>
            </div>
          )}
          {projects.length > 0 && (
            <div className="nav-section">
              <div className="nav-section-label">All projects</div>
              {projects.slice(0, 12).map((p) => (
                <SideLink key={p.id} to={`/projects/${p.id}/docs`}>
                  {p.name}
                </SideLink>
              ))}
            </div>
          )}
        </nav>
        <div style={{ marginTop: 'auto' }} className="muted">
          {bootError && <div style={{ color: 'var(--danger)', marginBottom: '0.5rem' }}>{bootError}</div>}
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
          <Route
            path="/projects"
            element={<Projects projects={projects} onChange={refreshProjects} />}
          />
          <Route path="/projects/:projectId" element={<ProjectLayout />}>
            <Route index element={<Navigate to="docs" replace />} />
            <Route path="docs" element={<DocsPage />} />
            <Route path="docs/:docId" element={<DocsPage />} />
            <Route path="review" element={<ReviewPage />} />
            <Route path="drift" element={<DriftPage />} />
            <Route path="graph" element={<GraphPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          {/* Friendly redirects when project id omitted */}
          <Route path="/docs" element={<PickProject projects={projects} area="docs" />} />
          <Route path="/review" element={<PickProject projects={projects} area="review" />} />
          <Route path="/drift" element={<PickProject projects={projects} area="drift" />} />
          <Route path="/graph" element={<PickProject projects={projects} area="graph" />} />
          <Route path="/settings" element={<PickProject projects={projects} area="settings" />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  );
}

function SideLink({ to, children }: { to: string; children: React.ReactNode }) {
  const loc = useLocation();
  const active =
    to === '/'
      ? loc.pathname === '/'
      : loc.pathname === to || loc.pathname.startsWith(`${to}/`);
  return (
    <Link to={to} className={active ? 'active' : ''}>
      {children}
    </Link>
  );
}

function PickProject({
  projects,
  area,
}: {
  projects: Project[];
  area: string;
}) {
  if (projects[0]) {
    return <Navigate to={`/projects/${projects[0].id}/${area}`} replace />;
  }
  return (
    <div className="card">
      <h2>Choose a project</h2>
      <p className="muted">Create a project first to open {area}.</p>
      <Link to="/projects">Go to projects →</Link>
    </div>
  );
}

void useParams;
