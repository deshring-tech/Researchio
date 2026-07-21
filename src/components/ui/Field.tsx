import type { ReactNode } from 'react';

/**
 * MODULE: components/ui/Field
 *
 * Purpose
 *   Label, control, hint and error message wired together with the ARIA
 *   attributes that make a form usable with assistive technology.
 *
 * Why a component
 *   Getting `htmlFor`/`id`/`aria-describedby`/`aria-invalid` right by hand at
 *   every input is exactly the kind of detail that silently rots. Centralising
 *   it means every form in the app is accessible by construction.
 */
export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: (props: {
    id: string;
    'aria-invalid': boolean;
    'aria-describedby': string | undefined;
  }) => ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>

      {children({ id, 'aria-invalid': Boolean(error), 'aria-describedby': describedBy })}

      {error ? (
        <p className="field-error" id={errorId}>
          {error}
        </p>
      ) : null}

      {hint ? (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
