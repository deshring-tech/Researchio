import { notFound, redirect } from 'next/navigation';

import { Sidebar } from '@/components/workspace/Sidebar';
import { AssistantPanel } from '@/components/workspace/AssistantPanel';
import { ResearchAssistant } from '@/components/workspace/ResearchAssistant';
import { getCurrentUser } from '@/server/auth/session';
import { assertProjectAccess, listProjects } from '@/server/services/project.service';
import { recoverStalledPapers } from '@/server/services/paper.service';
import { reindexPendingNotes } from '@/server/services/note.service';
import { prisma } from '@/server/db/prisma';
import { aiEnabled } from '@/server/ai/provider';
import { AppError } from '@/lib/errors';

/**
 * Workspace shell for a single project.
 *
 * Also the natural place to reconcile background state: opening a project
 * requeues any ingestion stranded by a restart and indexes notes saved while
 * the AI provider was unconfigured. Both are fire-and-forget and never block
 * the render.
 */
export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  try {
    await assertProjectAccess(projectId, user.id);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') {
      notFound();
    }
    throw error;
  }

  const [projects, paperCount] = await Promise.all([
    listProjects(user.id),
    prisma.paper.count({ where: { projectId } }),
  ]);

  // Reconciliation, deliberately not awaited.
  void recoverStalledPapers(projectId);
  void reindexPendingNotes(projectId);

  return (
    <div className="app-container">
      <Sidebar
        projects={projects.map((project) => ({ id: project.id, name: project.name }))}
        activeProjectId={projectId}
        paperCount={paperCount}
        userName={user.name}
      />

      <main className="main-content" style={{ padding: 'var(--spacing-6)' }}>
        {!aiEnabled() ? (
          <div className="banner banner-warning" style={{ marginBottom: 'var(--spacing-5)' }}>
            <div>
              <strong style={{ display: 'block' }}>AI features are switched off</strong>
              No <code>GEMINI_API_KEY</code> is configured, so drafting, search and document
              analysis are unavailable. Notes and uploads still work and will be indexed
              automatically once a key is added.
            </div>
          </div>
        ) : null}

        {children}
      </main>

      <AssistantPanel>
        <ResearchAssistant projectId={projectId} aiEnabled={aiEnabled()} />
      </AssistantPanel>
    </div>
  );
}
