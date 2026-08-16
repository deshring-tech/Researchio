import Link from 'next/link';
import { connection } from 'next/server';

/**
 * Not-found page.
 *
 * `connection()` forces dynamic rendering. Nonces are injected during
 * server-side rendering from the request's CSP header, so a statically
 * generated page would ship framework scripts with no nonce — the browser
 * would then block them under our strict `script-src` and this page would
 * never hydrate.
 */
export default async function NotFound() {
  await connection();

  return (
    <main className="centered-page">
      <div className="centered-card">
        <div className="card stack">
          <h1 className="h2" style={{ margin: 0 }}>
            Not found
          </h1>
          <p className="muted text-sm" style={{ margin: 0 }}>
            This page does not exist, or it belongs to another account.
          </p>
          <Link className="btn btn-primary" href="/" style={{ alignSelf: 'flex-start' }}>
            Back to workspace
          </Link>
        </div>
      </div>
    </main>
  );
}
