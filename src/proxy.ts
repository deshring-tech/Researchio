import { NextResponse, type NextRequest } from 'next/server';

/**
 * MODULE: proxy (formerly middleware)
 *
 * Purpose
 *   Two per-request concerns that must run before a route renders:
 *     1. A Content-Security-Policy carrying a fresh nonce.
 *     2. An optimistic redirect of clearly-unauthenticated traffic.
 *
 * Scope of the auth check — read before extending
 *   This checks only for the *presence* of a session cookie; it does not
 *   validate it. A forged cookie passes here and is rejected by `requireUser()`
 *   in the route itself, which is the real authorization boundary. Next.js
 *   documents proxy as unsuitable for session management precisely because it
 *   runs before the request reaches its handler, and a database round trip here
 *   would tax every request.
 *
 *   Treat the redirect as a UX optimization, never as a security control.
 */

const SESSION_COOKIE = 'researchio_session';

/** Routes reachable without a session. */
const PUBLIC_PATHS = ['/login', '/register'];

/**
 * Builds the CSP for one request.
 *
 * `script-src` is strict: only scripts carrying this request's nonce run, and
 * `strict-dynamic` lets those load their own chunks without whitelisting
 * origins. This is the directive that actually stops injected-script attacks.
 *
 * `style-src` permits `'unsafe-inline'`, which is a deliberate, narrower
 * compromise. The UI uses React inline `style` attributes throughout, and
 * `next/font` injects its own inline style element; a nonce-only policy would
 * strip the entire visual layout. Inline styles are a far weaker vector than
 * inline scripts — they cannot execute code — and the alternative is either a
 * policy that breaks the app or a false sense of protection from
 * `'unsafe-inline'` quietly applied to scripts too.
 *
 * `connect-src 'self'` is what confines the streaming chat endpoint and any
 * future fetch to this origin, so injected code cannot exfiltrate research
 * data to a third party.
 */
function buildCsp(nonce: string, isDevelopment: boolean): string {
  const directives = [
    "default-src 'self'",
    // React uses eval in development to rebuild server stacks in the browser.
    // Production builds do not, so the relaxation is scoped to dev only.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];

  // Would break local HTTP development, so it is production-only.
  if (!isDevelopment) {
    directives.push('upgrade-insecure-requests');
  }

  return directives.join('; ');
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  const isPublic = PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );

  const hasSession = request.cookies.has(SESSION_COOKIE);

  if (!isPublic && !hasSession) {
    const target = request.nextUrl.clone();
    target.pathname = '/login';
    target.search = '';
    return NextResponse.redirect(target);
  }

  const nonce = crypto.randomUUID().replace(/-/g, '');
  const csp = buildCsp(nonce, process.env.NODE_ENV === 'development');

  // The nonce travels on the request so the rendered document can stamp it
  // onto Next.js's own bootstrap scripts, and on the response so the browser
  // enforces the matching policy.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);

  return response;
}

export const config = {
  /**
   * Skips Next.js internals and static assets, which need no policy and no
   * auth check. `api` is excluded because those routes return JSON errors
   * rather than redirecting, and are guarded by `requireUser()` directly.
   *
   * Prefetches are skipped too: they fetch payloads rather than documents, so
   * generating a nonce for them wastes work and pollutes the cache key.
   */
  matcher: [
    {
      source:
        '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
