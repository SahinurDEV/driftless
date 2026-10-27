import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { api } from '../lib/api';
import EmptyState from '../components/EmptyState';
import { SkeletonLines } from '../components/Skeleton';

type Node = {
  id: string;
  type: 'doc' | 'repo' | 'code';
  label: string;
  path?: string;
  drift?: boolean;
  status?: string;
  repoId?: string | null;
};

type Edge = { from: string; to: string; kind: string };
type PosNode = Node & { x: number; y: number; w: number; h: number };

export default function GraphPage() {
  const { projectId } = useParams();
  const nav = useNavigate();
  const [nodes, setNodes] = useState<Node[] | null>(null);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  useEffect(() => {
    api<{ nodes: Node[]; edges: Edge[] }>(`/api/projects/${projectId}/graph`).then((r) => {
      setNodes(
        (r.nodes || []).map((n) => ({
          ...n,
          status: n.type === 'doc' ? (n.drift ? 'stale' : 'ok') : undefined,
        })),
      );
      setEdges(r.edges ?? []);
    });
  }, [projectId]);

  const positioned: PosNode[] = useMemo(() => {
    const list = nodes || [];
    const docs = list.filter((n) => n.type === 'doc');
    const repos = list.filter((n) => n.type === 'repo');
    const code = list.filter((n) => n.type === 'code').slice(0, 40);
    const place = (arr: Node[], y: number, gapX = 180) =>
      arr.map((n, i) => ({
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
        const mx = (a.x + a.w / 2 + b.x + b.w / 2) / 2;
        const my = (a.y + a.h / 2 + b.y + b.h / 2) / 2 - 24;
        return {
          ...e,
          x1: a.x + a.w / 2,
          y1: a.y + a.h / 2,
          x2: b.x + b.w / 2,
          y2: b.y + b.h / 2,
          mx,
          my,
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
      mx: number;
      my: number;
      drift: boolean;
    }[];
  }, [edges, byId]);

  const height = Math.max(420, ...positioned.map((n) => n.y + 80), 420);

  if (!nodes) {
    return (
      <div>
        <h2>Graph view</h2>
        <SkeletonLines lines={6} />
      </div>
    );
  }

  return (
    <div>
      <h2>Graph view</h2>
      <p className="muted">Docs linked to repos and covered paths. Nodes are colored by drift status.</p>
      {!positioned.length ? (
        <EmptyState
          title="No graph nodes yet"
          description="Add docs with covered_paths frontmatter to see connections."
        />
      ) : (
        <>
          <div className="graph" style={{ minHeight: Math.min(height, 560) }}>
            <div className="graph-toolbar">
              <button className="ghost" onClick={() => setScale((s) => Math.min(2, s + 0.15))} title="Zoom in">
                <ZoomIn size={16} />
              </button>
              <button className="ghost" onClick={() => setScale((s) => Math.max(0.5, s - 0.15))} title="Zoom out">
                <ZoomOut size={16} />
              </button>
              <button
                className="ghost"
                onClick={() => {
                  setScale(1);
                  setPan({ x: 0, y: 0 });
                }}
                title="Reset"
              >
                <Maximize2 size={16} />
              </button>
            </div>
            <div
              className="graph-canvas"
              style={{ height: Math.min(height, 560), overflow: 'hidden' }}
              onPointerDown={(e) => {
                drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
                (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (!drag.current) return;
                setPan({
                  x: drag.current.px + (e.clientX - drag.current.x),
                  y: drag.current.py + (e.clientY - drag.current.y),
                });
              }}
              onPointerUp={() => {
                drag.current = null;
              }}
            >
              <div
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
                  transformOrigin: '0 0',
                  position: 'relative',
                  width: '100%',
                  height,
                }}
              >
                <svg
                  className="graph-edges"
                  width="100%"
                  height={height}
                  style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
                >
                  <defs>
                    <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                      <path d="M 0 0 L 10 5 L 0 10 z" fill="#8aa0b8" />
                    </marker>
                    <marker id="arrow-drift" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                      <path d="M 0 0 L 10 5 L 0 10 z" fill="#e5484d" />
                    </marker>
                  </defs>
                  {drawnEdges.map((e, i) => (
                    <path
                      key={`${e.from}-${e.to}-${i}`}
                      d={`M ${e.x1} ${e.y1} Q ${e.mx} ${e.my} ${e.x2} ${e.y2}`}
                      fill="none"
                      stroke={e.drift ? '#e5484d' : e.kind === 'related' ? '#4d7fff' : '#8aa0b8'}
                      strokeWidth={e.drift ? 2.2 : 1.5}
                      strokeOpacity={e.kind === 'related' ? 0.55 : 0.9}
                      strokeDasharray={e.kind === 'related' ? '5 4' : undefined}
                      markerEnd={e.drift ? 'url(#arrow-drift)' : 'url(#arrow)'}
                    />
                  ))}
                </svg>
                {positioned.map((n) => (
                  <div
                    key={n.id}
                    className={`graph-node ${n.type}${n.status ? ` status-${n.status}` : ''}${n.drift ? ' drift' : ''}`}
                    style={{ left: n.x, top: n.y, width: n.w }}
                    title={`${n.label}${n.drift ? ' (drifted)' : ''}`}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      if (n.type === 'doc') nav(`/projects/${projectId}/docs/${n.id}`);
                    }}
                  >
                    {n.label}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="graph-legend">
            <span><span className="swatch" style={{ background: '#1f9d63' }} />Doc ok</span>
            <span><span className="swatch" style={{ background: '#c98500' }} />Doc stale</span>
            <span><span className="swatch" style={{ background: '#6b4eff' }} />Doc in review</span>
            <span><span className="swatch" style={{ background: '#4d7fff' }} />Repo</span>
            <span>Solid: belongs / covers · Dashed: related · Drag to pan · Zoom controls top-right</span>
          </div>
        </>
      )}
    </div>
  );
}
