'use client';

import { useActionState } from 'react';

import { SubmitButton } from '@/components/ui/SubmitButton';
import { deleteNoteAction } from '@/server/actions/note.actions';
import { formatRelativeTime } from '@/lib/format';
import type { ActionResult } from '@/lib/errors';

/**
 * MODULE: components/workspace/NoteList
 *
 * Purpose
 *   Render saved notes with a delete control.
 *
 * Why a Client Component
 *   Only for the per-note delete form's pending and error state. The note data
 *   itself is fetched on the server and passed in.
 */

export interface NoteView {
  id: string;
  content: string;
  createdAt: string;
}

export function NoteList({ notes }: { notes: NoteView[] }) {
  return (
    <div className="stack">
      {notes.map((note) => (
        <NoteCard key={note.id} note={note} />
      ))}
    </div>
  );
}

function NoteCard({ note }: { note: NoteView }) {
  const [state, formAction] = useActionState<ActionResult<undefined> | null, FormData>(
    deleteNoteAction,
    null,
  );

  return (
    <article className="card card-tight">
      <p style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {note.content}
      </p>

      <div
        className="row"
        style={{ justifyContent: 'space-between', marginTop: 'var(--spacing-3)' }}
      >
        <time className="text-xs muted" dateTime={note.createdAt}>
          {formatRelativeTime(note.createdAt)}
        </time>

        <form action={formAction}>
          <input type="hidden" name="noteId" value={note.id} />
          <SubmitButton variant="ghost" size="sm" pendingLabel="Deleting…">
            Delete
          </SubmitButton>
        </form>
      </div>

      {state && !state.ok ? (
        <p className="field-error" role="alert">
          {state.message}
        </p>
      ) : null}
    </article>
  );
}
