'use client';

import { useActionState, useState } from 'react';

import { Field } from '@/components/ui/Field';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { deleteProjectAction, updateProjectAction } from '@/server/actions/project.actions';
import { LIMITS } from '@/lib/validation/schemas';
import type { ActionResult } from '@/lib/errors';

/**
 * MODULE: components/workspace/ProjectSettingsForm
 *
 * Purpose
 *   Rename a project, revise its research question, and delete it.
 *
 * Deletion safeguard
 *   Deletion cascades to every note, source, chunk and section, and removes the
 *   uploaded files from disk. It is therefore gated behind typing the project
 *   name — a confirm dialog is too easy to dismiss reflexively for an action
 *   that destroys a thesis.
 */
export function ProjectSettingsForm({
  projectId,
  name,
  researchQuestion,
}: {
  projectId: string;
  name: string;
  researchQuestion: string | null;
}) {
  const [saveState, saveAction] = useActionState<ActionResult<undefined> | null, FormData>(
    updateProjectAction,
    null,
  );
  const [deleteState, deleteAction] = useActionState<ActionResult<undefined> | null, FormData>(
    deleteProjectAction,
    null,
  );

  const [confirmation, setConfirmation] = useState('');
  const canDelete = confirmation.trim() === name;

  const saveErrors = saveState && !saveState.ok ? saveState.fieldErrors : undefined;

  return (
    <div className="stack">
      <section className="card">
        <h2 className="h3">Project details</h2>

        <form action={saveAction} className="stack">
          <input type="hidden" name="projectId" value={projectId} />

          <Field id="project-name" label="Project name" error={saveErrors?.name}>
            {(props) => (
              <input
                {...props}
                className="input"
                name="name"
                defaultValue={name}
                maxLength={LIMITS.projectNameMax}
                required
              />
            )}
          </Field>

          <Field
            id="project-question"
            label="Research question"
            error={saveErrors?.researchQuestion}
            hint="Keeps AI drafting anchored to what you are investigating."
          >
            {(props) => (
              <textarea
                {...props}
                className="input"
                name="researchQuestion"
                rows={3}
                defaultValue={researchQuestion ?? ''}
                maxLength={LIMITS.researchQuestionMax}
              />
            )}
          </Field>

          {saveState && !saveState.ok && !saveState.fieldErrors ? (
            <p className="field-error" role="alert">
              {saveState.message}
            </p>
          ) : null}

          {saveState?.ok ? (
            <p className="text-sm" style={{ color: 'var(--success)', margin: 0 }} role="status">
              Saved.
            </p>
          ) : null}

          <div>
            <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
          </div>
        </form>
      </section>

      <section className="card" style={{ borderColor: '#fecaca' }}>
        <h2 className="h3" style={{ color: 'var(--error)' }}>
          Delete this project
        </h2>
        <p className="text-sm muted">
          This permanently removes the document, every note, every uploaded source and all
          indexed passages. It cannot be undone.
        </p>

        <form action={deleteAction} className="stack-sm">
          <input type="hidden" name="projectId" value={projectId} />

          <Field
            id="delete-confirm"
            label={`Type "${name}" to confirm`}
          >
            {(props) => (
              <input
                {...props}
                className="input"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
              />
            )}
          </Field>

          {deleteState && !deleteState.ok ? (
            <p className="field-error" role="alert">
              {deleteState.message}
            </p>
          ) : null}

          <div>
            <SubmitButton variant="danger" disabled={!canDelete} pendingLabel="Deleting…">
              Delete project permanently
            </SubmitButton>
          </div>
        </form>
      </section>
    </div>
  );
}
