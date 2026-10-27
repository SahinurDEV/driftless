import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { api } from '../lib/api';
import EmptyState from '../components/EmptyState';

type DocHit = { doc_id: string; title: string; snippet: string };
type CodeHit = { path: string; repo_id: string; snippet: string };

export default function SearchPage() {
  const { projectId } = useParams();
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<'all' | 'docs' | 'code'>('all');
  const [docs, setDocs] = useState<DocHit[]>([]);
  const [code, setCode] = useState<CodeHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [reindexMsg, setReindexMsg] = useState('');

  async function run(nextQ = q, nextScope = scope) {
    if (!projectId || !nextQ.trim()) {
      setDocs([]);
      setCode([]);
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ docs: DocHit[]; code: CodeHit[] }>(
        `/api/projects/${projectId}/search?q=${encodeURIComponent(nextQ)}&scope=${nextScope}`,
      );
      setDocs(r.docs || []);
      setCode(r.code || []);
    } finally {
      setBusy(false);
    }
  }

  async function reindex() {
    setReindexMsg('Indexing…');
    try {
      const r = await api<{ indexed: number }>(`/api/projects/${projectId}/code/reindex`, {
        method: 'POST',
      });
      setReindexMsg(`Indexed ${r.indexed} files`);
      if (q.trim()) run();
    } catch (e) {
      setReindexMsg(e instanceof Error ? e.message : 'Reindex failed');
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 style={{ margin: 0 }}>Unified search</h2>
          <p className="muted">Search docs and indexed code in one place.</p>
        </div>
        <button onClick={reindex}>Reindex code</button>
      </div>
      {reindexMsg && <p className="muted">{reindexMsg}</p>}
      <div className="row" style={{ marginBottom: '0.75rem' }}>
        <input
          placeholder="Search docs and code…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') run();
          }}
        />
        <button className="primary" disabled={busy || !q.trim()} onClick={() => run()}>
          <Search size={16} strokeWidth={1.75} /> {busy ? 'Searching…' : 'Search'}
        </button>
      </div>
      <div className="search-tabs">
        {(['all', 'docs', 'code'] as const).map((s) => (
          <button
            key={s}
            className={scope === s ? 'active' : ''}
            onClick={() => {
              setScope(s);
              run(q, s);
            }}
          >
            {s}
          </button>
        ))}
      </div>
      {!docs.length && !code.length ? (
        <EmptyState
          icon={<Search size={22} strokeWidth={1.75} />}
          title={q ? 'No matches' : 'Search this project'}
          description={
            q
              ? 'Try another query, or reindex code if you recently added folders.'
              : 'Type a keyword. Reindex code once after adding local repos.'
          }
        />
      ) : (
        <div className="split">
          <div>
            <h3>Docs</h3>
            <table className="table">
              <tbody>
                {docs.map((d) => (
                  <tr key={d.doc_id}>
                    <td>
                      <Link to={`/projects/${projectId}/docs/${d.doc_id}`}>{d.title}</Link>
                      <div className="muted" style={{ fontSize: '0.85rem' }}>
                        {d.snippet}
                      </div>
                    </td>
                  </tr>
                ))}
                {!docs.length && (
                  <tr>
                    <td className="muted">No doc hits</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div>
            <h3>Code</h3>
            <table className="table">
              <tbody>
                {code.map((c, i) => (
                  <tr key={`${c.path}-${i}`}>
                    <td>
                      <code style={{ fontFamily: 'var(--mono)', fontSize: '0.85rem' }}>{c.path}</code>
                      <div className="muted" style={{ fontSize: '0.85rem' }}>
                        {c.snippet}
                      </div>
                    </td>
                  </tr>
                ))}
                {!code.length && (
                  <tr>
                    <td className="muted">No code hits</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
