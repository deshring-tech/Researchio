import { DocumentUploader } from '@/components/workspace/DocumentUploader';
import { PaperList } from '@/components/workspace/PaperList';
import { EmptyState } from '@/components/ui/Feedback';
import { requireUser } from '@/server/auth/session';
import { assertProjectAccess } from '@/server/services/project.service';
import { prisma } from '@/server/db/prisma';

export default async function PapersPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const user = await requireUser();
  await assertProjectAccess(projectId, user.id);

  const papers = await prisma.paper.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { chunks: true } } },
  });

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="h1">Sources</h1>
          <p className="muted text-sm" style={{ margin: 0 }}>
            {papers.length === 0
              ? 'Nothing uploaded yet'
              : `${papers.length} document${papers.length > 1 ? 's' : ''}`}
          </p>
        </div>
      </header>

      <div className="stack">
        <section className="card">
          <h2 className="h3">Upload documents</h2>
          <DocumentUploader projectId={projectId} />
        </section>

        {papers.length === 0 ? (
          <EmptyState title="No source documents">
            Upload the papers this work builds on. Their text is extracted, split into
            passages and indexed, which is what lets the assistant and the drafting engine
            cite them.
          </EmptyState>
        ) : (
          <PaperList
            papers={papers.map((paper) => ({
              id: paper.id,
              title: paper.title,
              authors: paper.authors,
              year: paper.year,
              originalName: paper.originalName,
              sizeBytes: paper.sizeBytes,
              status: paper.status,
              statusMessage: paper.statusMessage,
              createdAt: paper.createdAt.toISOString(),
              pageCount: paper.pageCount,
              plainSummary: paper.plainSummary,
              techSummary: paper.techSummary,
              keyFindings: paper.keyFindings,
              methodology: paper.methodology,
              limitations: paper.limitations,
              chunkCount: paper._count.chunks,
            }))}
          />
        )}
      </div>
    </>
  );
}
