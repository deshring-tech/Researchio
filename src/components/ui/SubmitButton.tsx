'use client';

import { useFormStatus } from 'react-dom';
import type { ReactNode } from 'react';

/**
 * MODULE: components/ui/SubmitButton
 *
 * Purpose
 *   A submit button that disables itself and shows progress while its
 *   enclosing form is in flight.
 *
 * Why `useFormStatus`
 *   It reads the pending state of the nearest parent form, so no component
 *   needs to thread an `isSubmitting` flag down by hand. This also prevents the
 *   double-submission that plagues plain forms — notably duplicate uploads and
 *   duplicate notes.
 *
 * Constraint
 *   `useFormStatus` only reports status when the component is rendered *inside*
 *   the `<form>` element, not by the component that renders the form.
 */
export function SubmitButton({
  children,
  pendingLabel,
  variant = 'primary',
  size,
  block,
  disabled,
  title,
  formAction,
}: {
  children: ReactNode;
  pendingLabel?: string;
  variant?: 'primary' | 'secondary' | 'ai' | 'ghost' | 'danger';
  size?: 'sm';
  block?: boolean;
  disabled?: boolean;
  title?: string;
  formAction?: (formData: FormData) => void | Promise<void>;
}) {
  const { pending } = useFormStatus();

  const className = [
    'btn',
    `btn-${variant}`,
    size === 'sm' ? 'btn-sm' : '',
    block ? 'btn-block' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="submit"
      className={className}
      disabled={pending || disabled}
      title={title}
      formAction={formAction}
      aria-busy={pending}
    >
      {pending ? (
        <>
          <span className="spinner" aria-hidden="true" />
          {pendingLabel ?? children}
        </>
      ) : (
        children
      )}
    </button>
  );
}
