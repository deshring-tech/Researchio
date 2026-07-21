'use client';

import { useActionState, useEffect, useRef } from 'react';

import { SubmitButton } from '@/components/ui/SubmitButton';
import { createNoteAction } from '@/server/actions/note.actions';
import { LIMITS } from '@/lib/validation/schemas';
import type { ActionResult } from '@/lib/errors';

/**
 * MODULE: components/workspace/NoteComposer
 *
 * Purpose
 *   Capture a research note.
 *
 * Behaviour
 *   The form clears only after the server confirms the write. The previous
 *   implementation cleared the textarea immediately and logged to the console,
 *   so every note the researcher wrote was silently discarded — the single most
 *   damaging bug in the original build.
 *
 *   Ctrl/Cmd+Enter submits, since this is a field people type into constantly.
 */
export function NoteComposer({ projectId }: { projectId: string }) {
  const [state, formAction] = useActionState<ActionResult<undefined> | null, FormData>(
    createNoteAction,
    null,
  );

  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    // Each submission returns a new result object, so identity change is a
    // reliable signal that a fresh save just succeeded.
    if (state?.ok) {
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="stack-sm">
      <input type="hidden" name="projectId" value={projectId} />

      <label className="sr-only" htmlFor="note-content">
        Note
      </label>
      <textarea
        id="note-content"
        name="content"
        className="input"
        rows={4}
        maxLength={LIMITS.noteMax}
        placeholder="Record an observation, an idea, or a question to come back to…"
        required
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />

      {state && !state.ok ? (
        <p className="field-error" role="alert">
          {state.message}
        </p>
      ) : null}

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="text-xs muted">Ctrl + Enter to save</span>
        <SubmitButton pendingLabel="Saving…">Save note</SubmitButton>
      </div>
    </form>
  );
}
