import { Suspense } from 'react';
import Link from 'next/link';

import { DocumentUploader } from '@/components/workspace/DocumentUploader';
import { NoteComposer } from '@/components/workspace/NoteComposer';
import { NoteList } from '@/components/workspace/NoteList';
import { Timeline } from '@/components/workspace/Timeline';
import { EmptyState } from '@/components/ui/Feedback';
import { requireUser } from '@/server/auth/session';
import { NOTE_PAGE_SIZE, getProject } from '@/server/services/project.service';

export default async function NotebookPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ notes?: string }>;
}) {
  const [{ projectId }, { notes: notesParam }] = await Promise.all([params, searchParams]);
  const user = await requireUser();

  // `?notes=N` widens the page. Parsed defensively and clamped, since it is
  // user-controlled and feeds a database `take`.
  const requested = Number.parseInt(notesParam ?? '', 10);
  const noteLimit = Number.isFinite(requested)
    ? Math.min(Math.max(requested, NOTE_PAGE_SIZE), 1_000)
    : NOTE_PAGE_SIZE;

  const project = await getProject(projectId, user.id, { noteLimit });

  const totalNotes = project._count.notes;
  const hasMoreNotes = project.notes.length < totalNotes;

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
            <h2 className="h3">Notes ({totalNotes})</h2>

            {totalNotes === 0 ? (
              <EmptyState title="No notes yet">
                Notes are indexed alongside your uploaded sources, so the assistant and the
                drafting engine can both draw on them.
              </EmptyState>
            ) : (
              <>
                <NoteList
                  notes={project.notes.map((note) => ({
                    id: note.id,
                    content: note.content,
                    createdAt: note.createdAt.toISOString(),
                  }))}
                />

                {hasMoreNotes ? (
                  <div
                    className="row"
                    style={{
                      justifyContent: 'space-between',
                      marginTop: 'var(--spacing-4)',
                    }}
                  >
                    <span className="text-sm muted">
                      Showing {project.notes.length} of {totalNotes}
                    </span>
                    <Link
                      className="btn btn-secondary btn-sm"
                      href={`/p/${projectId}?notes=${noteLimit + NOTE_PAGE_SIZE}`}
                    >
                      Show older notes
                    </Link>
                  </div>
                ) : null}
              </>
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
