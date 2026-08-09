import { ResearchAssistant } from '@/components/workspace/ResearchAssistant';
import { requireUser } from '@/server/auth/session';
import { assertProjectAccess } from '@/server/services/project.service';
import { aiEnabled } from '@/server/ai/provider';

/**
 * Full-page research assistant.
 *
 * On wide screens the assistant lives in the right-hand panel of the workspace
 * shell. That panel is hidden below 1200px, which covers most laptops with
 * display scaling, every tablet and every phone — so this route is the
 * assistant's home on those viewports, reached from the sidebar.
 *
 * It is also useful on a wide screen when a long conversation deserves more
 * room than the panel gives it, so the route is always available rather than
 * being gated behind a media query.
 */
export default async function AssistantPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const user = await requireUser();
  await assertProjectAccess(projectId, user.id);

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="h1">Research Assistant</h1>
          <p className="muted text-sm" style={{ margin: 0 }}>
            Answers are grounded in this project&rsquo;s sources and notes, and cite the
            passages they came from.
          </p>
        </div>
      </header>

      {/*
        A fixed height gives the transcript its own scroll region, so the
        composer stays reachable instead of being pushed below the fold.
      */}
      <div
        className="card"
        style={{ display: 'flex', flexDirection: 'column', height: 'min(70vh, 640px)' }}
      >
        <ResearchAssistant projectId={projectId} aiEnabled={aiEnabled()} />
      </div>
    </>
  );
}
