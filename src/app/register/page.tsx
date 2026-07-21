import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AuthForm } from '@/components/auth/AuthForm';
import { getCurrentUser } from '@/server/auth/session';

export const metadata: Metadata = { title: 'Create account' };

export default async function RegisterPage() {
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
          <h1 className="h2">Create your account</h1>
          <p className="muted text-sm" style={{ marginTop: 0, marginBottom: 'var(--spacing-5)' }}>
            Your projects, sources and notes stay private to your account.
          </p>
          <AuthForm mode="register" />
        </div>
      </div>
    </main>
  );
}
