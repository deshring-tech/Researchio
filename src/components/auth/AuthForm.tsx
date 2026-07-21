'use client';

import { useActionState } from 'react';
import Link from 'next/link';

import { Field } from '@/components/ui/Field';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { loginAction, registerAction } from '@/server/actions/auth.actions';
import { LIMITS } from '@/lib/validation/schemas';
import type { ActionResult } from '@/lib/errors';

/**
 * MODULE: components/auth/AuthForm
 *
 * Purpose
 *   Sign-in and sign-up form.
 *
 * Design
 *   One component covers both modes because they share the entire submission,
 *   error-rendering and pending-state pipeline; only the field set differs.
 *   `useActionState` keeps the server's validation messages attached to the
 *   fields that produced them, so errors survive without client-side
 *   revalidation logic duplicating the server's rules.
 */
export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const isRegister = mode === 'register';
  const action = isRegister ? registerAction : loginAction;

  const [state, formAction] = useActionState<ActionResult<undefined> | null, FormData>(
    action,
    null,
  );

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  // A failure with no field attribution is a form-level problem worth showing
  // on its own; field-level ones already render beneath their input.
  const formError =
    state && !state.ok && !state.fieldErrors ? state.message : undefined;

  return (
    <form action={formAction} className="stack" noValidate>
      {formError ? (
        <div className="banner banner-error" role="alert">
          {formError}
        </div>
      ) : null}

      {isRegister ? (
        <Field id="name" label="Name" error={fieldErrors?.name}>
          {(props) => (
            <input
              {...props}
              className="input"
              name="name"
              type="text"
              autoComplete="name"
              maxLength={LIMITS.nameMax}
              required
            />
          )}
        </Field>
      ) : null}

      <Field id="email" label="Email" error={fieldErrors?.email}>
        {(props) => (
          <input
            {...props}
            className="input"
            name="email"
            type="email"
            autoComplete="email"
            required
          />
        )}
      </Field>

      <Field
        id="password"
        label="Password"
        error={fieldErrors?.password}
        hint={isRegister ? `At least ${LIMITS.passwordMin} characters.` : undefined}
      >
        {(props) => (
          <input
            {...props}
            className="input"
            name="password"
            type="password"
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            required
          />
        )}
      </Field>

      {isRegister ? (
        <Field
          id="confirmPassword"
          label="Confirm password"
          error={fieldErrors?.confirmPassword}
        >
          {(props) => (
            <input
              {...props}
              className="input"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
            />
          )}
        </Field>
      ) : null}

      <SubmitButton block pendingLabel={isRegister ? 'Creating account…' : 'Signing in…'}>
        {isRegister ? 'Create account' : 'Sign in'}
      </SubmitButton>

      <p className="text-sm muted" style={{ margin: 0, textAlign: 'center' }}>
        {isRegister ? (
          <>
            Already have an account? <Link href="/login">Sign in</Link>
          </>
        ) : (
          <>
            No account yet? <Link href="/register">Create one</Link>
          </>
        )}
      </p>
    </form>
  );
}
