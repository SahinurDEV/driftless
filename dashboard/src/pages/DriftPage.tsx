import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, MessageSquare, UserPlus } from 'lucide-react';
import { api } from '../lib/api';
import EmptyState from '../components/EmptyState';
import { SkeletonLines } from '../components/Skeleton';

type Flag = {
  id: string;
  doc_id: string;
  doc_path: string;
  doc_title: string;
  reason: string;
  match_type: string;
  commit_sha: string | null;
  created_at: string;
  assignee?: string | null;
  assignee_name?: string | null;
};

type Comment = { id: string; author_name: string; body: string; created_at: string };
type TeamMember = { id: string; name: string };

export default function DriftPage() {
  const { projectId } = useParams();
  const [flags, setFlags] = useState<Flag[] | null>(null);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<Flag | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [comment, setComment] = useState('');
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [newMember, setNewMember] = useState('');

  async function load() {
    const q = filter ? `?assignee=${encodeURIComponent(filter)}` : '';
    const r = await api<{ flags: Flag[] }>(`/api/projects/${projectId}/drift${q}`);
    setFlags(r.flags);
  }

  useEffect(() => {
    load().catch(console.error);
    api<{ team: TeamMember[] }>(`/api/projects/${projectId}/team`)
      .then((r) => setTeam(r.team || []))
      .catch(() => {});
  }, [projectId, filter]);

  async function dismiss(id: string) {
    await api(`/api/projects/${projectId}/drift/${id}/dismiss`, { method: 'POST' });
    setSelected(null);
    await load();
  }

  async function openFlag(f: Flag) {
    setSelected(f);
    const r = await api<{ comments: Comment[] }>(`/api/projects/${projectId}/drift/${f.id}/comments`);
    setComments(r.comments || []);
  }

  async function assign(flagId: string, name: string) {
    await api(`/api/projects/${projectId}/drift/${flagId}/assign`, {
      method: 'POST',
      body: JSON.stringify({ assignee: name, assignee_name: name }),
    });
    await load();
    if (selected?.id === flagId) setSelected({ ...selected, assignee: name, assignee_name: name });
  }

  async function addComment() {
    if (!selected || !comment.trim()) return;
    await api(`/api/projects/${projectId}/drift/${selected.id}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: comment }),
    });
    setComment('');
    const r = await api<{ comments: Comment[] }>(
      `/api/projects/${projectId}/drift/${selected.id}/comments`,
    );
    setComments(r.comments || []);
  }

  async function addTeam() {
    if (!newMember.trim()) return;
    await api(`/api/projects/${projectId}/team`, {
      method: 'POST',
      body: JSON.stringify({ name: newMember.trim() }),
    });
    setNewMember('');
    const r = await api<{ team: TeamMember[] }>(`/api/projects/${projectId}/team`);
    setTeam(r.team || []);
  }

  if (!flags) {
    return (
      <div>
        <h2>Drift view</h2>
        <SkeletonLines lines={5} />
      </div>
    );
  }

  return (
    <div className="split">
      <div>
        <div className="page-header">
          <div>
            <h2 style={{ margin: 0 }}>Drift view</h2>
            <p className="muted">Docs flagged because related code changed or tests failed.</p>
          </div>
        </div>
        <div className="row" style={{ marginBottom: '0.75rem' }}>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ maxWidth: 220 }}
          >
            <option value="">All assignees</option>
            {team.map((t) => (
              <option key={t.id} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
          <input
            placeholder="Add team name"
            value={newMember}
            onChange={(e) => setNewMember(e.target.value)}
            style={{ maxWidth: 180 }}
          />
          <button onClick={addTeam}>
            <UserPlus size={16} /> Add
          </button>
        </div>
        {!flags.length ? (
          <EmptyState
            icon={<AlertTriangle size={22} strokeWidth={1.75} />}
            title="No open drift flags"
            description="When covered code changes or matching tests fail, flags show up here."
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Doc</th>
                <th>Match</th>
                <th>Assignee</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {flags.map((f) => (
                <tr key={f.id} style={{ cursor: 'pointer' }} onClick={() => openFlag(f)}>
                  <td>
                    <Link to={`/projects/${projectId}/docs/${f.doc_id}`} onClick={(e) => e.stopPropagation()}>
                      {f.doc_title}
                    </Link>
                    <div className="muted" style={{ fontSize: '0.85rem' }}>
                      {f.reason}
                    </div>
                  </td>
                  <td>
                    <span className="badge stale">{f.match_type}</span>
                  </td>
                  <td className="muted">{f.assignee_name || f.assignee || '—'}</td>
                  <td>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        dismiss(f.id);
                      }}
                    >
                      Dismiss
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div>
        {selected ? (
          <div className="card">
            <h3 style={{ marginTop: 0 }}>{selected.doc_title}</h3>
            <p className="muted">{selected.reason}</p>
            <div className="row" style={{ marginBottom: '0.75rem' }}>
              <select
                value={selected.assignee_name || selected.assignee || ''}
                onChange={(e) => assign(selected.id, e.target.value)}
              >
                <option value="">Unassigned</option>
                {team.map((t) => (
                  <option key={t.id} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <h4>
              <MessageSquare size={16} style={{ verticalAlign: 'middle' }} /> Comments
            </h4>
            {comments.map((c) => (
              <div key={c.id} style={{ marginBottom: '0.65rem' }}>
                <strong>{c.author_name}</strong>{' '}
                <span className="muted" style={{ fontSize: '0.8rem' }}>
                  {new Date(c.created_at).toLocaleString()}
                </span>
                <div>{c.body}</div>
              </div>
            ))}
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Add a comment…"
              style={{ minHeight: 90 }}
            />
            <button className="primary" style={{ marginTop: '0.5rem' }} onClick={addComment}>
              Comment
            </button>
          </div>
        ) : (
          <EmptyState title="Select a flag" description="Open a drift flag to assign it or leave comments." />
        )}
      </div>
    </div>
  );
}
