import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { CreateProjectForm } from '@/components/workspace/CreateProjectForm';
import { getCurrentUser } from '@/server/auth/session';
import { listProjects } from '@/server/services/project.service';

export const metadata: Metadata = { title: 'New project' };

export default async function NewProjectPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/login');
  }

  const projects = await listProjects(user.id);
  const isFirstProject = projects.length === 0;

  return (
    <main className="centered-page">
      <div className="centered-card centered-card-wide">
        <div className="brand" style={{ marginBottom: 'var(--spacing-6)' }}>
          <span className="brand-mark" aria-hidden="true" />
          Researchio
        </div>

        <div className="card">
          <h1 className="h2">{isFirstProject ? 'Start your first project' : 'New project'}</h1>
          <p className="muted text-sm" style={{ marginTop: 0, marginBottom: 'var(--spacing-5)' }}>
            {isFirstProject
              ? 'A project holds your sources, notes and the document they build toward.'
              : 'Each project keeps its own sources, notes and document.'}
          </p>

          <CreateProjectForm />
        </div>

        {!isFirstProject ? (
          <p className="text-sm" style={{ textAlign: 'center', marginTop: 'var(--spacing-4)' }}>
            <Link href={`/p/${projects[0].id}`}>Back to workspace</Link>
          </p>
        ) : null}
      </div>
    </main>
  );
}
