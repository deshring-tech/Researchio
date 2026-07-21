'use server';

import { redirect } from 'next/navigation';

import { authenticate, register } from '@/server/services/auth.service';
import { createSession, destroySession, pruneExpiredSessions } from '@/server/auth/session';
import { run } from '@/server/actions/runner';
import { loginSchema, parseFormData, registerSchema } from '@/lib/validation/schemas';
import type { ActionResult } from '@/lib/errors';

/**
 * MODULE: server/actions/auth
 *
 * Purpose
 *   Sign-up, sign-in and sign-out entry points for the auth forms.
 *
 * Note on redirects
 *   `redirect()` throws a control-flow exception, so it is called only after
 *   `run()` has returned successfully — never inside it, where the error
 *   handler would misreport it as a failure.
 */

export async function registerAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  const result = await run('auth.register', async () => {
    const input = parseFormData(registerSchema, formData);
    const user = await register(input);
    await createSession(user.id);
  });

  if (result.ok) {
    redirect('/');
  }

  return result;
}

export async function loginAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  const result = await run('auth.login', async () => {
    const input = parseFormData(loginSchema, formData);
    const user = await authenticate(input);
    await createSession(user.id);
    await pruneExpiredSessions();
  });

  if (result.ok) {
    redirect('/');
  }

  return result;
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect('/login');
}
