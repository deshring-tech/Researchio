'use client';

import { useActionState, useEffect, useRef } from 'react';

import { SubmitButton } from '@/components/ui/SubmitButton';
import { addSectionAction } from '@/server/actions/document.actions';
import { LIMITS } from '@/lib/validation/schemas';
import type { ActionResult } from '@/lib/errors';

/** MODULE: components/workspace/AddSectionForm — appends a section to the outline. */
export function AddSectionForm({ projectId }: { projectId: string }) {
  const [state, formAction] = useActionState<ActionResult<undefined> | null, FormData>(
    addSectionAction,
    null,
  );

  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="stack-sm">
      <input type="hidden" name="projectId" value={projectId} />

      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <label className="sr-only" htmlFor="new-section-title">
          New section title
        </label>
        <input
          id="new-section-title"
          name="title"
          className="input"
          placeholder="Add a section, e.g. Threats to Validity"
          maxLength={LIMITS.sectionTitleMax}
          required
        />
        <SubmitButton variant="secondary" pendingLabel="Adding…">
          Add
        </SubmitButton>
      </div>

      {state && !state.ok ? (
        <p className="field-error" role="alert">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
