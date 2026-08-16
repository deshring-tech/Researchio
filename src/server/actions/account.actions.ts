'use server';

import { redirect } from 'next/navigation';

import {
  destroySession,
  requireUser,
  revokeOtherSessions,
} from '@/server/auth/session';
import {
  changePassword,
  deleteAccount,
  updateProfile,
  verifyCurrentPassword,
} from '@/server/services/auth.service';
import { deleteUploads } from '@/server/storage/files';
import { logger } from '@/server/observability/logger';
import { revalidateWorkspace, run } from '@/server/actions/runner';
import {
  changePasswordSchema,
  changeProfileSchema,
  deleteAccountSchema,
  parseFormData,
} from '@/lib/validation/schemas';
import { AppError, type ActionResult } from '@/lib/errors';

/**
 * MODULE: server/actions/account
 *
 * Purpose
 *   Let a user manage their own account: profile, password, and deletion.
 *
 * Why this exists
 *   Without it a user cannot rotate a leaked password, correct their email, or
 *   remove their personal data — and this application stores unpublished
 *   research, which makes all three non-optional.
 */

export async function updateProfileAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  const result = await run('account.updateProfile', async () => {
    const user = await requireUser();
    const input = parseFormData(changeProfileSchema, formData);
    await updateProfile(user.id, input);
  });

  if (!result.ok) {
    return result;
  }

  revalidateWorkspace();
  return { ok: true, data: undefined };
}

export async function changePasswordAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  const result = await run('account.changePassword', async () => {
    const user = await requireUser();
    const input = parseFormData(changePasswordSchema, formData);

    await changePassword(user.id, input);

    // Anyone signed in with the old password loses access immediately. The
    // current session is preserved so the user is not logged out of the page
    // they are standing on.
    const revoked = await revokeOtherSessions(user.id);
    logger.info('Password changed', { userId: user.id, sessionsRevoked: revoked });
  });

  return result.ok ? { ok: true, data: undefined } : result;
}

export async function deleteAccountAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  const result = await run('account.delete', async () => {
    const user = await requireUser();
    const input = parseFormData(deleteAccountSchema, formData);

    // Typed confirmation and password are both required: this destroys every
    // project permanently and an unattended session must not be enough.
    if (input.confirmation.trim() !== user.email) {
      throw new AppError('VALIDATION', 'Type your email address exactly to confirm.', {
        fieldErrors: { confirmation: 'That does not match your email address.' },
      });
    }

    if (!(await verifyCurrentPassword(user.id, input.password))) {
      throw new AppError('UNAUTHORIZED', 'That password is not correct.', {
        fieldErrors: { password: 'That password is not correct.' },
      });
    }

    const storageKeys = await deleteAccount(user.id);
    await deleteUploads(storageKeys);

    logger.info('Account deleted', { userId: user.id, filesRemoved: storageKeys.length });
  });

  if (!result.ok) {
    return result;
  }

  // The user row is gone, so the session cookie now points at nothing; clear
  // it explicitly rather than leaving a dead cookie in the browser.
  await destroySession();
  redirect('/login');
}
