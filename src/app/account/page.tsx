import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import {
  DeleteAccountForm,
  PasswordForm,
  ProfileForm,
} from '@/components/account/AccountForms';
import { getCurrentUser } from '@/server/auth/session';
import { listProjects } from '@/server/services/project.service';

export const metadata: Metadata = { title: 'Account' };

/**
 * Account settings.
 *
 * Deliberately outside the `/p/[projectId]` shell: these settings belong to the
 * person, not to a project, and deleting the account removes every project the
 * shell would try to render.
 */
export default async function AccountPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/login');
  }

  const projects = await listProjects(user.id);

  return (
    <main className="centered-page" style={{ alignItems: 'flex-start', paddingTop: 'var(--spacing-12)' }}>
      <div className="centered-card centered-card-wide">
        <div
          className="row"
          style={{ justifyContent: 'space-between', marginBottom: 'var(--spacing-6)' }}
        >
          <span className="brand">
            <span className="brand-mark" aria-hidden="true" />
            Researchio
          </span>

          {projects.length > 0 ? (
            <Link className="text-sm" href={`/p/${projects[0].id}`}>
              Back to workspace
            </Link>
          ) : null}
        </div>

        <h1 className="h1" style={{ marginBottom: 'var(--spacing-2)' }}>
          Account
        </h1>
        <p className="muted text-sm" style={{ marginTop: 0, marginBottom: 'var(--spacing-6)' }}>
          {projects.length === 0
            ? 'You have no projects yet.'
            : `${projects.length} project${projects.length > 1 ? 's' : ''}.`}
        </p>

        <div className="stack">
          <ProfileForm name={user.name} email={user.email} />
          <PasswordForm />
          <DeleteAccountForm email={user.email} />
        </div>
      </div>
    </main>
  );
}
