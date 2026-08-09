'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import { logoutAction } from '@/server/actions/auth.actions';

/**
 * MODULE: components/workspace/Sidebar
 *
 * Purpose
 *   Project switching and view navigation.
 *
 * Why a Client Component
 *   It needs `usePathname` to mark the current view, and the project switcher
 *   navigates on change. Everything it renders is passed in as props, so it
 *   performs no data fetching of its own.
 */

export interface SidebarProject {
  id: string;
  name: string;
}

export function Sidebar({
  projects,
  activeProjectId,
  paperCount,
  userName,
}: {
  projects: SidebarProject[];
  activeProjectId: string;
  paperCount: number;
  userName: string;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const base = `/p/${activeProjectId}`;

  const views = [
    { href: base, label: 'Notebook', icon: '📝', className: '' },
    { href: `${base}/papers`, label: `Sources (${paperCount})`, icon: '📚', className: '' },
    { href: `${base}/document`, label: 'Living Document', icon: '📄', className: '' },
    // Only rendered once the right-hand assistant panel is hidden by CSS.
    {
      href: `${base}/assistant`,
      label: 'Assistant',
      icon: '💬',
      className: 'nav-when-panel-hidden',
    },
    { href: `${base}/settings`, label: 'Settings', icon: '⚙️', className: '' },
  ];

  return (
    <aside className="sidebar">
      <div
        style={{
          padding: 'var(--spacing-4)',
          borderBottom: '1px solid var(--border-color)',
        }}
      >
        <Link href="/" className="brand" style={{ color: 'inherit' }}>
          <span className="brand-mark" aria-hidden="true" />
          Researchio
        </Link>
      </div>

      <div style={{ padding: 'var(--spacing-4)' }} className="stack">
        <div>
          <label className="label" htmlFor="project-switcher">
            Workspace
          </label>
          <select
            id="project-switcher"
            className="input"
            style={{ fontWeight: 600, cursor: 'pointer' }}
            value={activeProjectId}
            onChange={(event) => {
              const value = event.target.value;
              router.push(value === '__new__' ? '/new' : `/p/${value}`);
            }}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
            <option value="__new__">+ New project…</option>
          </select>
        </div>

        <nav className="stack-sm" aria-label="Project views">
          {views.map((view) => {
            // Exact match for the notebook root; prefix match would light it up
            // on every nested view.
            const isActive =
              view.href === base ? pathname === base : pathname.startsWith(view.href);

            return (
              <Link
                key={view.href}
                href={view.href}
                className={`btn btn-nav ${view.className}`.trim()}
                aria-current={isActive ? 'page' : undefined}
              >
                <span aria-hidden="true">{view.icon}</span>
                {view.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div
        style={{
          marginTop: 'auto',
          padding: 'var(--spacing-4)',
          borderTop: '1px solid var(--border-color)',
        }}
        className="stack-sm"
      >
        <span className="text-xs muted" title={userName}>
          Signed in as {userName}
        </span>
        <form action={logoutAction}>
          <button type="submit" className="btn btn-ghost btn-sm" style={{ paddingLeft: 0 }}>
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
