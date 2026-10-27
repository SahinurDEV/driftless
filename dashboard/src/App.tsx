import { Link, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Home as HomeIcon,
  FolderKanban,
  FileText,
  ClipboardCheck,
  AlertTriangle,
  Share2,
  Settings,
  LayoutDashboard,
  Search,
} from 'lucide-react';
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
import OverviewPage from './pages/OverviewPage';
import SearchPage from './pages/SearchPage';
import { SkeletonLines } from './components/Skeleton';

const iconProps = { size: 16, strokeWidth: 1.75 } as const;

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [projects, setProjects] = useState<Project[]>([]);
  const [bootError, setBootError] = useState('');
  const loc = useLocation();

  const refreshProjects = useCallback(async () => {
    const r = await api<{ projects: Project[] }>('/api/projects');
    setProjects(r.projects);
  }, []);

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
        <div style={{ width: 220 }}>
          <SkeletonLines lines={2} />
        </div>
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
          <SideLink to="/" icon={<HomeIcon {...iconProps} />}>
            Home
          </SideLink>
          <SideLink to="/overview" icon={<LayoutDashboard {...iconProps} />}>
            Overview
          </SideLink>
          <SideLink to="/projects" icon={<FolderKanban {...iconProps} />}>
            Projects
          </SideLink>
          {activeProject && (
            <div className="nav-section">
              <div className="nav-section-label">{activeProject.name}</div>
              <SideLink to={`/projects/${activeProject.id}/docs`} icon={<FileText {...iconProps} />}>
                Docs
              </SideLink>
              <SideLink to={`/projects/${activeProject.id}/search`} icon={<Search {...iconProps} />}>
                Search
              </SideLink>
              <SideLink
                to={`/projects/${activeProject.id}/review`}
                icon={<ClipboardCheck {...iconProps} />}
              >
                Review
              </SideLink>
              <SideLink
                to={`/projects/${activeProject.id}/drift`}
                icon={<AlertTriangle {...iconProps} />}
              >
                Drift
              </SideLink>
              <SideLink to={`/projects/${activeProject.id}/graph`} icon={<Share2 {...iconProps} />}>
                Graph
              </SideLink>
              <SideLink
                to={`/projects/${activeProject.id}/settings`}
                icon={<Settings {...iconProps} />}
              >
                Settings
              </SideLink>
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
          <Route path="/overview" element={<OverviewPage />} />
          <Route
            path="/projects"
            element={<Projects projects={projects} onChange={refreshProjects} />}
          />
          <Route path="/projects/:projectId" element={<ProjectLayout />}>
            <Route index element={<Navigate to="docs" replace />} />
            <Route path="docs" element={<DocsPage />} />
            <Route path="docs/:docId" element={<DocsPage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="review" element={<ReviewPage />} />
            <Route path="drift" element={<DriftPage />} />
            <Route path="graph" element={<GraphPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
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

function SideLink({
  to,
  children,
  icon,
}: {
  to: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  const loc = useLocation();
  const active =
    to === '/'
      ? loc.pathname === '/'
      : loc.pathname === to || loc.pathname.startsWith(`${to}/`);
  return (
    <Link to={to} className={active ? 'active' : ''}>
      {icon}
      <span>{children}</span>
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
