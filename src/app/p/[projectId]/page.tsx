import { Suspense } from 'react';

import { DocumentUploader } from '@/components/workspace/DocumentUploader';
import { NoteComposer } from '@/components/workspace/NoteComposer';
import { NoteList } from '@/components/workspace/NoteList';
import { Timeline } from '@/components/workspace/Timeline';
import { EmptyState } from '@/components/ui/Feedback';
import { requireUser } from '@/server/auth/session';
import { getProject } from '@/server/services/project.service';

export default async function NotebookPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const user = await requireUser();
  const project = await getProject(projectId, user.id);

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="h1">Research Notebook</h1>
          <p className="muted text-sm" style={{ margin: 0 }}>
            {project.name}
          </p>
        </div>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 2fr) minmax(240px, 1fr)',
          gap: 'var(--spacing-6)',
          alignItems: 'start',
        }}
      >
        <div className="stack">
          <section className="card">
            <h2 className="h3">Add sources</h2>
            <DocumentUploader projectId={projectId} />
          </section>

          <section className="card">
            <h2 className="h3">New note</h2>
            <NoteComposer projectId={projectId} />
          </section>

          <section>
            <h2 className="h3">Notes ({project.notes.length})</h2>

            {project.notes.length === 0 ? (
              <EmptyState title="No notes yet">
                Notes are indexed alongside your uploaded sources, so the assistant and the
                drafting engine can both draw on them.
              </EmptyState>
            ) : (
              <NoteList
                notes={project.notes.map((note) => ({
                  id: note.id,
                  content: note.content,
                  createdAt: note.createdAt.toISOString(),
                }))}
              />
            )}
          </section>
        </div>

        <section className="card" style={{ position: 'sticky', top: 0 }}>
          <h2 className="h3">Activity</h2>
          {/*
            Streamed separately so the notebook renders without waiting on the
            timeline query.
          */}
          <Suspense fallback={<p className="text-sm muted">Loading activity…</p>}>
            <Timeline projectId={projectId} />
          </Suspense>
        </section>
      </div>
    </>
  );
}
