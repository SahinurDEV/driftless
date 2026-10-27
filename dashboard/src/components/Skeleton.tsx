export function SkeletonLines({ lines = 3 }: { lines?: number }) {
  return (
    <div>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skeleton line" style={{ width: `${88 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function SkeletonCards({ count = 3 }: { count?: number }) {
  return (
    <div className="cards">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card">
          <div className="skeleton block" />
          <div className="skeleton line" style={{ width: '60%', marginTop: '0.75rem' }} />
        </div>
      ))}
    </div>
  );
}
