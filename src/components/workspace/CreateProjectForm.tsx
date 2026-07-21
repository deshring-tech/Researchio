'use client';

import { useActionState } from 'react';

import { Field } from '@/components/ui/Field';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { createProjectAction } from '@/server/actions/project.actions';
import { DOCUMENT_TYPES } from '@/lib/domain/constants';
import { LIMITS } from '@/lib/validation/schemas';
import type { ActionResult } from '@/lib/errors';

/**
 * MODULE: components/workspace/CreateProjectForm
 *
 * Purpose
 *   Collect the minimum needed to scaffold a project: a name, the kind of
 *   document being produced, and optionally the research question.
 *
 * Why the document type matters here
 *   It determines the default section outline, so asking once at creation gives
 *   the researcher a structured document immediately instead of a blank page.
 */
export function CreateProjectForm() {
  const [state, formAction] = useActionState<ActionResult<undefined> | null, FormData>(
    createProjectAction,
    null,
  );

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  const formError = state && !state.ok && !state.fieldErrors ? state.message : undefined;

  return (
    <form action={formAction} className="stack" noValidate>
      {formError ? (
        <div className="banner banner-error" role="alert">
          {formError}
        </div>
      ) : null}

      <Field id="name" label="Project name" error={fieldErrors?.name}>
        {(props) => (
          <input
            {...props}
            className="input"
            name="name"
            type="text"
            placeholder="e.g. Quantum Error Correction"
            maxLength={LIMITS.projectNameMax}
            required
            autoFocus
          />
        )}
      </Field>

      <Field
        id="documentType"
        label="What are you writing?"
        error={fieldErrors?.documentType}
        hint="This sets the starting section outline. You can change the sections later."
      >
        {(props) => (
          <select {...props} className="input" name="documentType" defaultValue="Thesis">
            {DOCUMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        )}
      </Field>

      <Field
        id="researchQuestion"
        label="Research question (optional)"
        error={fieldErrors?.researchQuestion}
        hint="Used to keep AI drafting anchored to what you are actually investigating."
      >
        {(props) => (
          <textarea
            {...props}
            className="input"
            name="researchQuestion"
            rows={3}
            maxLength={LIMITS.researchQuestionMax}
            placeholder="What specific question does this work answer?"
          />
        )}
      </Field>

      <SubmitButton block pendingLabel="Creating project…">
        Create project
      </SubmitButton>
    </form>
  );
}
