import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';

type Flag = {
  id: string;
  doc_id: string;
  doc_path: string;
  doc_title: string;
  reason: string;
  match_type: string;
  commit_sha: string | null;
  created_at: string;
};

export default function DriftPage() {
  const { projectId } = useParams();
  const [flags, setFlags] = useState<Flag[]>([]);

  async function load() {
    const r = await api<{ flags: Flag[] }>(`/api/projects/${projectId}/drift`);
    setFlags(r.flags);
  }

  useEffect(() => {
    load().catch(console.error);
  }, [projectId]);

  async function dismiss(id: string) {
    await api(`/api/projects/${projectId}/drift/${id}/dismiss`, { method: 'POST' });
    await load();
  }

  return (
    <div>
      <h2>Drift view</h2>
      <p className="muted">Docs flagged because related code changed.</p>
      <table className="table">
        <thead>
          <tr>
            <th>Doc</th>
            <th>Match</th>
            <th>Reason</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {flags.map((f) => (
            <tr key={f.id}>
              <td>
                <Link to={`/projects/${projectId}/docs/${f.doc_id}`}>{f.doc_title}</Link>
                <div className="muted">{f.doc_path}</div>
              </td>
              <td>
                <span className="badge stale">{f.match_type}</span>
              </td>
              <td className="muted">{f.reason}</td>
              <td>
                <button onClick={() => dismiss(f.id)}>Dismiss</button>
              </td>
            </tr>
          ))}
          {!flags.length && (
            <tr>
              <td colSpan={4} className="muted">
                No open drift flags.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
