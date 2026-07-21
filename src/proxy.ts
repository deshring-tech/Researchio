import { NextResponse, type NextRequest } from 'next/server';

/**
 * MODULE: proxy (formerly middleware)
 *
 * Purpose
 *   Cheap, optimistic redirect of clearly-unauthenticated traffic away from the
 *   workspace, before a route renders.
 *
 * Scope — read this before adding to it
 *   This checks only for the *presence* of a session cookie. It does not
 *   validate it. A forged cookie passes here and is rejected by
 *   `requireUser()` in the route itself, which is the real authorization
 *   boundary. Next.js documents proxy as unsuitable for session management
 *   precisely because it runs before the request reaches its handler, and
 *   database work here would tax every asset request.
 *
 *   Treat this as a UX optimization, never as a security control.
 */

const SESSION_COOKIE = 'researchio_session';

/** Routes reachable without a session. */
const PUBLIC_PATHS = ['/login', '/register'];

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  const isPublic = PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );

  if (isPublic) {
    return NextResponse.next();
  }

  if (request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.next();
  }

  const target = request.nextUrl.clone();
  target.pathname = '/login';
  target.search = '';

  return NextResponse.redirect(target);
}

export const config = {
  /**
   * Skip Next.js internals, the API surface (which returns JSON errors rather
   * than redirecting), and static assets.
   */
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
