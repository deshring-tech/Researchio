import Link from 'next/link';

export default function NotFound() {
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
