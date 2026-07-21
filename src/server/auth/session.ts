import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { cache } from 'react';

import { env } from '@/server/config/env';
import { prisma } from '@/server/db/prisma';
import { unauthorized } from '@/lib/errors';

/**
 * MODULE: server/auth/session
 *
 * Purpose
 *   Issue, read and revoke authenticated sessions.
 *
 * Design
 *   An opaque 256-bit random token lives in an httpOnly cookie; only its
 *   SHA-256 hash is stored. A database leak therefore yields no usable
 *   credential. Tokens carry no claims, so revocation is immediate and real —
 *   unlike a stateless JWT, which stays valid until it expires.
 *
 *   SHA-256 is correct here (unlike for passwords): the token already has full
 *   entropy, so there is nothing to brute-force and no need for a slow KDF.
 *
 * Public: `createSession`, `getCurrentUser`, `requireUser`, `destroySession`
 */

const COOKIE_NAME = 'researchio_session';
const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

/** Sessions past their halfway point are extended on use, giving sliding expiry. */
const RENEW_THRESHOLD_MS = SESSION_MS / 2;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function cookieOptions(expires: Date) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.secureCookies,
    path: '/',
    expires,
  };
}

/**
 * Creates a session for `userId` and attaches the cookie to the response.
 * Callable only from a Server Action or Route Handler, since it writes a cookie.
 */
export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_MS);

  await prisma.session.create({
    data: { tokenHash: hashToken(token), userId, expiresAt },
  });

  const store = await cookies();
  store.set(COOKIE_NAME, token, cookieOptions(expiresAt));
}

/**
 * Resolves the signed-in user, or null.
 *
 * Wrapped in React `cache` so the many components that need the current user
 * within one render share a single database query.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      expiresAt: true,
      user: { select: { id: true, email: true, name: true } },
    },
  });

  if (!session) {
    return null;
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    // Opportunistic cleanup of the row we just proved is dead.
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  await extendIfStale(session.id, session.expiresAt);

  return session.user;
});

/**
 * Slides the expiry of an actively-used session.
 *
 * Failures are swallowed deliberately: this runs during render, where cookie
 * writes are not permitted, and a missed renewal is harmless — the session
 * simply keeps its original expiry.
 */
async function extendIfStale(sessionId: string, expiresAt: Date): Promise<void> {
  const remaining = expiresAt.getTime() - Date.now();
  if (remaining > RENEW_THRESHOLD_MS) {
    return;
  }

  await prisma.session
    .update({
      where: { id: sessionId },
      data: { expiresAt: new Date(Date.now() + SESSION_MS) },
    })
    .catch(() => undefined);
}

/** Resolves the signed-in user or throws `UNAUTHORIZED`. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw unauthorized();
  }
  return user;
}

/** Revokes the current session and clears the cookie. */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;

  if (token) {
    await prisma.session
      .deleteMany({ where: { tokenHash: hashToken(token) } })
      .catch(() => undefined);
  }

  store.delete(COOKIE_NAME);
}

/** Removes expired sessions. Invoked opportunistically on sign-in. */
export async function pruneExpiredSessions(): Promise<void> {
  await prisma.session
    .deleteMany({ where: { expiresAt: { lte: new Date() } } })
    .catch(() => undefined);
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
