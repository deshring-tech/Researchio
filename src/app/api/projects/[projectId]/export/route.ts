import { requireUser } from '@/server/auth/session';
import { getProject } from '@/server/services/project.service';
import { toCitationView } from '@/server/services/document.service';
import { logger } from '@/server/observability/logger';
import { renderMarkdown } from '@/lib/export/markdown';
import { AppError } from '@/lib/errors';
import { formatDate } from '@/lib/format';

/**
 * ROUTE: GET /api/projects/[projectId]/export
 *
 * Purpose
 *   Export the living document as Markdown with footnoted citations and a
 *   reference list.
 *
 * Why Markdown
 *   It is lossless for what this document contains, opens everywhere, and
 *   converts to Word or LaTeX via Pandoc with footnotes intact.
 *
 *   Only accepted prose and accepted citations are exported. Pending AI
 *   proposals are excluded by design — an unreviewed draft must never leave
 *   the app looking like finished work.
 */

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'document'
  );
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  try {
    const { projectId } = await context.params;
    const user = await requireUser();
    const project = await getProject(projectId, user.id);

    const body = renderMarkdown({
      name: project.name,
      documentType: project.document?.type ?? 'Document',
      researchQuestion: project.researchQuestion,
      exportedOn: formatDate(new Date()),
      sections: (project.document?.sections ?? []).map((section) => ({
        title: section.title,
        content: section.userContent,
        citations: section.citations.flatMap((row) => {
          const view = toCitationView(row);
          return view && view.status === 'accepted' ? [view] : [];
        }),
      })),
      consultedSources: project.papers
        .filter((paper) => paper.status === 'ready')
        .map((paper) => ({ title: paper.title, authors: paper.authors, year: paper.year })),
    });

    return new Response(body, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${slugify(project.name)}.md"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    const appError =
      error instanceof AppError ? error : new AppError('INTERNAL', 'Could not export.');

    if (!appError.expected) {
      logger.error('Document export failed', error);
    }

    return Response.json({ error: appError.message }, { status: appError.status });
  }
}
