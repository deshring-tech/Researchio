import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AuthForm } from '@/components/auth/AuthForm';
import { getCurrentUser } from '@/server/auth/session';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage() {
  // An authenticated visitor has no business on the sign-in page.
  if (await getCurrentUser()) {
    redirect('/');
  }

  return (
    <main className="centered-page">
      <div className="centered-card">
        <div className="brand" style={{ marginBottom: 'var(--spacing-6)' }}>
          <span className="brand-mark" aria-hidden="true" />
          Researchio
        </div>

        <div className="card">
          <h1 className="h2">Sign in</h1>
          <p className="muted text-sm" style={{ marginTop: 0, marginBottom: 'var(--spacing-5)' }}>
            Continue to your research workspace.
          </p>
          <AuthForm mode="login" />
        </div>
      </div>
    </main>
  );
}
