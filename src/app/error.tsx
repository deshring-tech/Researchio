'use client';

import { useEffect } from 'react';
import Link from 'next/link';

/**
 * Root error boundary.
 *
 * Renders for any uncaught error in a route below it. The underlying message is
 * deliberately not displayed: in production it may contain internals, and it is
 * already logged server-side. The digest is shown so a user can quote it in a
 * support request.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[boundary]', error);
  }, [error]);

  return (
    <main className="centered-page">
      <div className="centered-card">
        <div className="card stack">
          <h1 className="h2" style={{ margin: 0 }}>
            Something went wrong
          </h1>
          <p className="muted text-sm" style={{ margin: 0 }}>
            The page could not be loaded. Your work is saved.
          </p>

          {error.digest ? (
            <p className="text-xs muted" style={{ margin: 0 }}>
              Reference: <code>{error.digest}</code>
            </p>
          ) : null}

          <div className="row">
            <button type="button" className="btn btn-primary" onClick={reset}>
              Try again
            </button>
            <Link className="btn btn-secondary" href="/">
              Back to workspace
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
