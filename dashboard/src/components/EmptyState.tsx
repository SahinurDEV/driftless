import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';

export default function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="icon-wrap">{icon || <Inbox size={22} strokeWidth={1.75} />}</div>
      <h3>{title}</h3>
      {description && <p className="muted">{description}</p>}
      {action && <div style={{ marginTop: '0.85rem' }}>{action}</div>}
    </div>
  );
}
