export default function StatusBadge({ status }: { status: string }) {
  const s = (status || 'ok').toLowerCase();
  const cls =
    s === 'ok' ? 'ok' : s === 'stale' ? 'stale' : s === 'review' || s === 'in review' || s === 'in-review' ? 'review' : '';
  const label = s === 'review' ? 'in review' : s;
  return <span className={`badge ${cls}`}>{label}</span>;
}
