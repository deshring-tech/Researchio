import 'server-only';

import { randomBytes } from 'node:crypto';

import { prisma } from '@/server/db/prisma';
import { hashPassword, verifyPassword } from '@/server/auth/password';
import { AppError, notFound } from '@/lib/errors';

/**
 * MODULE: server/services/auth
 *
 * Purpose
 *   Account creation and credential verification.
 *
 * Security notes
 *   - Sign-in reports one generic message for both "unknown email" and "wrong
 *     password", so the form cannot be used to enumerate registered accounts.
 *   - When the email is unknown, a hash is still computed against a dummy
 *     value. Without it, a missing account would return noticeably faster than
 *     a wrong password, leaking the same information through timing.
 *
 * Public: `register`, `authenticate`
 */

const INVALID_CREDENTIALS = 'That email and password combination is not recognised.';

/**
 * A real hash of a random secret, used to burn equivalent CPU time when the
 * account does not exist.
 *
 * Generated at runtime rather than hardcoded so its cost parameters and key
 * length always match those of genuine hashes — a hand-written constant would
 * silently stop matching the moment `COST` is raised, reintroducing the timing
 * signal it exists to remove. Computed once and memoized.
 */
let decoyHash: Promise<string> | null = null;

function timingDecoyHash(): Promise<string> {
  decoyHash ??= hashPassword(randomBytes(32).toString('hex'));
  return decoyHash;
}

export interface Credentials {
  email: string;
  password: string;
}

export async function register(input: Credentials & { name: string }) {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });

  if (existing) {
    throw new AppError('CONFLICT', 'An account with that email already exists.', {
      fieldErrors: { email: 'An account with that email already exists.' },
    });
  }

  const passwordHash = await hashPassword(input.password);

  return prisma.user.create({
    data: { name: input.name, email: input.email, passwordHash },
    select: { id: true, email: true, name: true },
  });
}

/**
 * Changes a password after verifying the current one.
 *
 * @returns Nothing. The caller is responsible for revoking other sessions —
 *   see `revokeOtherSessions`, which needs the current session's identity.
 * @throws AppError UNAUTHORIZED when the current password is wrong.
 */
export async function changePassword(
  userId: string,
  input: { currentPassword: string; newPassword: string },
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });

  if (!user) {
    throw notFound('Account');
  }

  const matches = await verifyPassword(input.currentPassword, user.passwordHash);
  if (!matches) {
    throw new AppError('UNAUTHORIZED', 'That is not your current password.', {
      fieldErrors: { currentPassword: 'That is not your current password.' },
    });
  }

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(input.newPassword) },
  });
}

export async function updateProfile(
  userId: string,
  input: { name: string; email: string },
) {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });

  if (existing && existing.id !== userId) {
    throw new AppError('CONFLICT', 'That email is already in use.', {
      fieldErrors: { email: 'That email is already in use.' },
    });
  }

  return prisma.user.update({
    where: { id: userId },
    data: { name: input.name, email: input.email },
    select: { id: true, email: true, name: true },
  });
}

/**
 * Verifies a password without issuing a session.
 *
 * Used to re-authenticate before destructive actions such as account deletion.
 */
export async function verifyCurrentPassword(
  userId: string,
  password: string,
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });

  return user ? verifyPassword(password, user.passwordHash) : false;
}

/**
 * Permanently deletes an account and everything belonging to it.
 *
 * Projects, documents, notes, papers, chunks, citations and sessions all
 * cascade from `User`. Uploaded files live on disk rather than in the
 * database, so their storage keys are returned for the caller to remove — the
 * service deliberately performs no file I/O.
 *
 * @returns Storage keys of every file that must now be deleted from disk.
 */
export async function deleteAccount(userId: string): Promise<string[]> {
  const papers = await prisma.paper.findMany({
    where: { project: { ownerId: userId }, storageKey: { not: null } },
    select: { storageKey: true },
  });

  await prisma.user.delete({ where: { id: userId } });

  return papers
    .map((paper) => paper.storageKey)
    .filter((key): key is string => key !== null);
}

export async function authenticate(input: Credentials) {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, email: true, name: true, passwordHash: true },
  });

  const matches = await verifyPassword(
    input.password,
    user?.passwordHash ?? (await timingDecoyHash()),
  );

  if (!user || !matches) {
    throw new AppError('UNAUTHORIZED', INVALID_CREDENTIALS, {
      fieldErrors: { password: INVALID_CREDENTIALS },
    });
  }

  return { id: user.id, email: user.email, name: user.name };
}
