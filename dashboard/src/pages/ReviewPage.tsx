import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import EmptyState from '../components/EmptyState';

type Item = {
  id: string;
  doc_id: string;
  doc_path: string;
  doc_title: string;
  summary: string | null;
  base_version: number;
  proposed_content: string;
  created_at: string;
};

export default function ReviewPage() {
  const { projectId } = useParams();
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<Item | null>(null);

  async function load() {
    const r = await api<{ items: Item[] }>(`/api/projects/${projectId}/review`);
    setItems(r.items);
  }

  useEffect(() => {
    load().catch(console.error);
  }, [projectId]);

  async function decide(id: string, action: 'approve' | 'reject') {
    await api(`/api/projects/${projectId}/review/${id}/${action}`, { method: 'POST' });
    setSelected(null);
    await load();
  }

  return (
    <div className="split">
      <div>
        <h2>Review queue</h2>
        <p className="muted">AI-suggested edits waiting for approval.</p>
        <table className="table">
          <thead>
            <tr>
              <th>Doc</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} onClick={() => setSelected(it)} style={{ cursor: 'pointer' }}>
                <td>
                  {it.doc_title}
                  <div className="muted">{it.summary || it.doc_path}</div>
                </td>
                <td className="muted">{new Date(it.created_at).toLocaleString()}</td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td colSpan={2}>
                  <EmptyState title="Nothing pending" description="AI-suggested edits will land here in review mode." />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div>
        {selected ? (
          <div className="card">
            <div className="row" style={{ marginBottom: '0.75rem' }}>
              <button className="primary" onClick={() => decide(selected.id, 'approve')}>
                Approve
              </button>
              <button onClick={() => decide(selected.id, 'reject')}>Reject</button>
            </div>
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                fontFamily: 'var(--mono)',
                fontSize: '0.85rem',
                maxHeight: 480,
                overflow: 'auto',
              }}
            >
              {selected.proposed_content}
            </pre>
          </div>
        ) : (
          <div className="card muted">Select an item.</div>
        )}
      </div>
    </div>
  );
}
