import { ProjectSettingsForm } from '@/components/workspace/ProjectSettingsForm';
import { requireUser } from '@/server/auth/session';
import { assertProjectAccess } from '@/server/services/project.service';
import { prisma } from '@/server/db/prisma';
import { notFound } from '@/lib/errors';

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const user = await requireUser();
  await assertProjectAccess(projectId, user.id);

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, researchQuestion: true },
  });

  if (!project) {
    throw notFound('Project');
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="h1">Project settings</h1>
          <p className="muted text-sm" style={{ margin: 0 }}>
            {project.name}
          </p>
        </div>
      </header>

      <div style={{ maxWidth: '640px' }}>
        <ProjectSettingsForm
          projectId={project.id}
          name={project.name}
          researchQuestion={project.researchQuestion}
        />
      </div>
    </>
  );
}
