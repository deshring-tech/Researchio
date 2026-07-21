import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/server/auth/session';
import { listProjects } from '@/server/services/project.service';

/**
 * Workspace entry point.
 *
 * Holds no UI of its own: it decides where a visitor belongs and forwards them
 * there. Keeping this decision in one place means every other route can assume
 * an authenticated user with at least one project.
 */
export default async function HomePage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/login');
  }

  const projects = await listProjects(user.id);

  if (projects.length === 0) {
    redirect('/new');
  }

  redirect(`/p/${projects[0].id}`);
}
