import 'server-only';

import { randomBytes } from 'node:crypto';

import { prisma } from '@/server/db/prisma';
import { hashPassword, verifyPassword } from '@/server/auth/password';
import { AppError } from '@/lib/errors';

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
