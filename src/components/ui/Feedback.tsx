import type { ReactNode } from 'react';

/**
 * MODULE: components/ui/Feedback
 *
 * Purpose
 *   Presentational primitives for empty states.
 *
 * Note
 *   A Server Component — it holds no state and ships no JavaScript. Banner and
 *   pill styling live in `globals.css` and are applied directly where used,
 *   which avoids a wrapper component that adds indirection without behaviour.
 */
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <p style={{ margin: 0, fontWeight: 600, color: 'var(--text-primary)' }}>{title}</p>
      {children ? (
        <p className="text-sm" style={{ margin: 'var(--spacing-2) 0 0' }}>
          {children}
        </p>
      ) : null}
    </div>
  );
}
