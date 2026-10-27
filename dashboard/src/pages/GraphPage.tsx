import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';

type Node = {
  id: string;
  type: 'doc' | 'repo' | 'code';
  label: string;
  path?: string;
  drift?: boolean;
  repoId?: string | null;
};

type Edge = { from: string; to: string; kind: string };

type PosNode = Node & { x: number; y: number; w: number; h: number };

export default function GraphPage() {
  const { projectId } = useParams();
  const nav = useNavigate();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  useEffect(() => {
    api<{ nodes: Node[]; edges: Edge[] }>(`/api/projects/${projectId}/graph`).then((r) => {
      setNodes(r.nodes);
      setEdges(r.edges ?? []);
    });
  }, [projectId]);

  const positioned: PosNode[] = useMemo(() => {
    const docs = nodes.filter((n) => n.type === 'doc');
    const repos = nodes.filter((n) => n.type === 'repo');
    const code = nodes.filter((n) => n.type === 'code').slice(0, 40);
    const place = (list: Node[], y: number, gapX = 180) =>
      list.map((n, i) => ({
        ...n,
        x: 48 + (i % 5) * gapX,
        y: y + Math.floor(i / 5) * 78,
        w: n.type === 'code' ? 140 : 150,
        h: 36,
      }));
    return [...place(repos, 36), ...place(docs, 170), ...place(code, 330, 170)];
  }, [nodes]);

  const byId = useMemo(() => {
    const m = new Map<string, PosNode>();
    for (const n of positioned) m.set(n.id, n);
    return m;
  }, [positioned]);

  const drawnEdges = useMemo(() => {
    return edges
      .map((e) => {
        const a = byId.get(e.from);
        const b = byId.get(e.to);
        if (!a || !b) return null;
        return {
          ...e,
          x1: a.x + a.w / 2,
          y1: a.y + a.h / 2,
          x2: b.x + b.w / 2,
          y2: b.y + b.h / 2,
          drift: !!(a.drift || b.drift),
        };
      })
      .filter(Boolean) as {
      from: string;
      to: string;
      kind: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      drift: boolean;
    }[];
  }, [edges, byId]);

  const height = Math.max(420, ...positioned.map((n) => n.y + 80), 420);

  return (
    <div>
      <h2>Graph view</h2>
      <p className="muted">
        Docs linked to repos and covered paths. Drifted docs and their edges glow red.
      </p>
      <div className="graph" style={{ minHeight: height }}>
        <svg
          className="graph-edges"
          width="100%"
          height={height}
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        >
          <defs>
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#4a5d78" />
            </marker>
            <marker
              id="arrow-drift"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#ff6b7a" />
            </marker>
          </defs>
          {drawnEdges.map((e, i) => (
            <line
              key={`${e.from}-${e.to}-${i}`}
              x1={e.x1}
              y1={e.y1}
              x2={e.x2}
              y2={e.y2}
              className={e.drift ? 'graph-edge drift' : 'graph-edge'}
              stroke={e.drift ? '#ff6b7a' : e.kind === 'related' ? '#5b8cff' : '#3a4d66'}
              strokeWidth={e.drift ? 2.2 : 1.4}
              strokeOpacity={e.kind === 'related' ? 0.55 : 0.85}
              strokeDasharray={e.kind === 'related' ? '5 4' : undefined}
              markerEnd={e.drift ? 'url(#arrow-drift)' : 'url(#arrow)'}
            />
          ))}
        </svg>
        {positioned.map((n) => (
          <div
            key={n.id}
            className={`graph-node ${n.type}${n.drift ? ' drift' : ''}`}
            style={{ left: n.x, top: n.y, width: n.w }}
            title={`${n.label}${n.drift ? ' (drifted)' : ''}`}
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
      <div className="row muted" style={{ marginTop: '0.75rem', fontSize: '0.85rem', gap: '1rem' }}>
        <span>Solid: belongs / covers</span>
        <span>Dashed: related docs</span>
        <span style={{ color: 'var(--danger)' }}>Red: drift</span>
      </div>
    </div>
  );
}
