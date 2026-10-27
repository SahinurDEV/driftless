import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LayoutDashboard } from 'lucide-react';
import { api } from '../lib/api';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import { SkeletonCards } from '../components/Skeleton';

type OverviewProject = {
  id: string;
  name: string;
  slug: string;
  trust_mode: string;
  docs: { ok: number; stale: number; review: number; total: number };
  open_flags: number;
  last_activity: string;
  repos: { id: string; github_owner: string; github_name: string; local_path?: string | null }[];
};

export default function OverviewPage() {
  const [projects, setProjects] = useState<OverviewProject[] | null>(null);

  useEffect(() => {
    api<{ projects: OverviewProject[] }>('/api/overview')
      .then((r) => setProjects(r.projects))
      .catch(() => setProjects([]));
  }, []);

  if (!projects) {
    return (
      <div>
        <h1>Multi-repo overview</h1>
        <SkeletonCards count={4} />
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 style={{ margin: 0 }}>Multi-repo overview</h1>
          <p className="muted">Health across every project and connected folder/repo.</p>
        </div>
      </div>
      {!projects.length ? (
        <EmptyState
          icon={<LayoutDashboard size={22} strokeWidth={1.75} />}
          title="No projects yet"
          description="Create a project and add a local folder or GitHub repo to see health stats here."
          action={<Link className="btn primary" to="/projects">Create project</Link>}
        />
      ) : (
        <div className="cards">
          {projects.map((p) => (
            <div key={p.id} className="card">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h3 style={{ margin: 0 }}>
                  <Link to={`/projects/${p.id}/docs`}>{p.name}</Link>
                </h3>
                <StatusBadge status={p.docs.stale ? 'stale' : p.docs.review ? 'review' : 'ok'} />
              </div>
              <div className="muted" style={{ fontSize: '0.85rem', marginTop: '0.25rem' }}>
                {p.slug} · trust: {p.trust_mode}
              </div>
              <div className="stat-grid" style={{ marginTop: '0.75rem' }}>
                <div className="stat">
                  <div className="label">Docs ok</div>
                  <div className="value">{p.docs.ok}</div>
                </div>
                <div className="stat">
                  <div className="label">Stale</div>
                  <div className="value">{p.docs.stale}</div>
                </div>
                <div className="stat">
                  <div className="label">In review</div>
                  <div className="value">{p.docs.review}</div>
                </div>
                <div className="stat">
                  <div className="label">Open flags</div>
                  <div className="value">{p.open_flags}</div>
                </div>
              </div>
              <div className="muted" style={{ fontSize: '0.8rem' }}>
                {(p.repos || []).length} repo(s)
                {(p.repos || []).slice(0, 3).map((r) => (
                  <div key={r.id}>
                    {r.local_path || `${r.github_owner}/${r.github_name}`}
                  </div>
                ))}
              </div>
              <div className="row" style={{ marginTop: '0.75rem' }}>
                <Link className="btn" to={`/projects/${p.id}/drift`}>
                  Drift
                </Link>
                <Link className="btn" to={`/projects/${p.id}/search`}>
                  Search
                </Link>
              </div>
              <div className="muted" style={{ fontSize: '0.75rem', marginTop: '0.5rem' }}>
                Last activity {new Date(p.last_activity).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
