import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';

type Node = {
  id: string;
  type: 'doc' | 'repo' | 'code';
  label: string;
  path?: string;
  drift?: boolean;
};

export default function GraphPage() {
  const { projectId } = useParams();
  const nav = useNavigate();
  const [nodes, setNodes] = useState<Node[]>([]);

  useEffect(() => {
    api<{ nodes: Node[] }>(`/api/projects/${projectId}/graph`).then((r) => setNodes(r.nodes));
  }, [projectId]);

  const positioned = useMemo(() => {
    const docs = nodes.filter((n) => n.type === 'doc');
    const repos = nodes.filter((n) => n.type === 'repo');
    const code = nodes.filter((n) => n.type === 'code').slice(0, 40);
    const place = (list: Node[], y: number) =>
      list.map((n, i) => ({
        ...n,
        x: 40 + (i % 6) * 160,
        y: y + Math.floor(i / 6) * 70,
      }));
    return [...place(repos, 30), ...place(docs, 160), ...place(code, 320)];
  }, [nodes]);

  return (
    <div>
      <h2>Graph view</h2>
      <p className="muted">Docs, repos, and covered code paths. Drifted docs glow red.</p>
      <div className="graph">
        {positioned.map((n) => (
          <div
            key={n.id}
            className={`graph-node ${n.type}${n.drift ? ' drift' : ''}`}
            style={{ left: n.x, top: n.y }}
            title={n.label}
            onClick={() => {
              if (n.type === 'doc') nav(`/projects/${projectId}/docs/${n.id}`);
            }}
          >
            {n.label}
          </div>
        ))}
        {!positioned.length && (
          <div className="muted" style={{ padding: '1rem' }}>
            No nodes yet — add docs with covered_paths.
          </div>
        )}
      </div>
    </div>
  );
}
