'use client';

import { useActionState, useState } from 'react';

import { Field } from '@/components/ui/Field';
import { SubmitButton } from '@/components/ui/SubmitButton';
import {
  changePasswordAction,
  deleteAccountAction,
  updateProfileAction,
} from '@/server/actions/account.actions';
import { LIMITS } from '@/lib/validation/schemas';
import type { ActionResult } from '@/lib/errors';

/**
 * MODULE: components/account/AccountForms
 *
 * Purpose
 *   Profile, password and account-deletion forms.
 *
 * Split into three independent forms on purpose: each submits separately, so a
 * validation failure in one cannot discard what the user typed in another.
 */

type Result = ActionResult<undefined> | null;

function fieldErrorsOf(state: Result) {
  return state && !state.ok ? state.fieldErrors : undefined;
}

function formErrorOf(state: Result) {
  return state && !state.ok && !state.fieldErrors ? state.message : undefined;
}

export function ProfileForm({ name, email }: { name: string; email: string }) {
  const [state, formAction] = useActionState<Result, FormData>(updateProfileAction, null);
  const errors = fieldErrorsOf(state);

  return (
    <section className="card">
      <h2 className="h3">Profile</h2>

      <form action={formAction} className="stack" noValidate>
        {formErrorOf(state) ? (
          <div className="banner banner-error" role="alert">
            {formErrorOf(state)}
          </div>
        ) : null}

        <Field id="account-name" label="Name" error={errors?.name}>
          {(props) => (
            <input
              {...props}
              className="input"
              name="name"
              defaultValue={name}
              maxLength={LIMITS.nameMax}
              autoComplete="name"
              required
            />
          )}
        </Field>

        <Field id="account-email" label="Email" error={errors?.email}>
          {(props) => (
            <input
              {...props}
              className="input"
              name="email"
              type="email"
              defaultValue={email}
              autoComplete="email"
              required
            />
          )}
        </Field>

        {state?.ok ? (
          <p className="text-sm" style={{ color: 'var(--success)', margin: 0 }} role="status">
            Profile updated.
          </p>
        ) : null}

        <div>
          <SubmitButton pendingLabel="Saving…">Save profile</SubmitButton>
        </div>
      </form>
    </section>
  );
}

export function PasswordForm() {
  const [state, formAction] = useActionState<Result, FormData>(changePasswordAction, null);
  const errors = fieldErrorsOf(state);

  return (
    <section className="card">
      <h2 className="h3">Password</h2>
      <p className="text-sm muted" style={{ marginTop: 0 }}>
        Changing your password signs out every other device.
      </p>

      <form action={formAction} className="stack" noValidate>
        {formErrorOf(state) ? (
          <div className="banner banner-error" role="alert">
            {formErrorOf(state)}
          </div>
        ) : null}

        <Field
          id="current-password"
          label="Current password"
          error={errors?.currentPassword}
        >
          {(props) => (
            <input
              {...props}
              className="input"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
            />
          )}
        </Field>

        <Field
          id="new-password"
          label="New password"
          error={errors?.newPassword}
          hint={`At least ${LIMITS.passwordMin} characters.`}
        >
          {(props) => (
            <input
              {...props}
              className="input"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              required
            />
          )}
        </Field>

        <Field
          id="confirm-new-password"
          label="Confirm new password"
          error={errors?.confirmPassword}
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

        {state?.ok ? (
          <p className="text-sm" style={{ color: 'var(--success)', margin: 0 }} role="status">
            Password changed. Other devices have been signed out.
          </p>
        ) : null}

        <div>
          <SubmitButton pendingLabel="Changing…">Change password</SubmitButton>
        </div>
      </form>
    </section>
  );
}

export function DeleteAccountForm({ email }: { email: string }) {
  const [state, formAction] = useActionState<Result, FormData>(deleteAccountAction, null);
  const [confirmation, setConfirmation] = useState('');
  const errors = fieldErrorsOf(state);

  const matches = confirmation.trim() === email;

  return (
    <section className="card" style={{ borderColor: '#fecaca' }}>
      <h2 className="h3" style={{ color: 'var(--error)' }}>
        Delete account
      </h2>
      <p className="text-sm muted" style={{ marginTop: 0 }}>
        This permanently removes your account, every project, all notes, every uploaded
        source and all indexed passages. It cannot be undone and there is no backup.
      </p>

      <form action={formAction} className="stack" noValidate>
        {formErrorOf(state) ? (
          <div className="banner banner-error" role="alert">
            {formErrorOf(state)}
          </div>
        ) : null}

        <Field
          id="delete-confirmation"
          label={`Type ${email} to confirm`}
          error={errors?.confirmation}
        >
          {(props) => (
            <input
              {...props}
              className="input"
              name="confirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
            />
          )}
        </Field>

        <Field id="delete-password" label="Your password" error={errors?.password}>
          {(props) => (
            <input
              {...props}
              className="input"
              name="password"
              type="password"
              autoComplete="current-password"
            />
          )}
        </Field>

        <div>
          <SubmitButton variant="danger" disabled={!matches} pendingLabel="Deleting…">
            Delete my account permanently
          </SubmitButton>
        </div>
      </form>
    </section>
  );
}
