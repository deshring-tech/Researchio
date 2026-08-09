'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * MODULE: components/workspace/AssistantPanel
 *
 * Purpose
 *   The workspace shell's right-hand panel, suppressed on the dedicated
 *   assistant route.
 *
 * Why
 *   Without this, visiting /assistant on a wide screen renders two independent
 *   chat panels side by side, each with its own state — the page version and
 *   the shell version.
 *
 * Note
 *   `children` is a Server Component rendered on the server and passed through
 *   as an already-rendered tree. This wrapper only decides whether to place it,
 *   so making the decision on the client costs no extra data fetching.
 */
export function AssistantPanel({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (pathname.endsWith('/assistant')) {
    return null;
  }

  return (
    <aside className="right-panel">
      <div
        style={{
          padding: 'var(--spacing-4)',
          fontWeight: 600,
          borderBottom: '1px solid var(--border-color)',
        }}
      >
        Research Assistant
      </div>
      <div
        style={{
          flex: 1,
          padding: 'var(--spacing-4)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {children}
      </div>
    </aside>
  );
}
