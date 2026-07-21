import { requireUser } from '@/server/auth/session';
import { getProject } from '@/server/services/project.service';
import { AppError } from '@/lib/errors';
import { formatDate } from '@/lib/format';

/**
 * ROUTE: GET /api/projects/[projectId]/export
 *
 * Purpose
 *   Export the living document as Markdown.
 *
 * Why Markdown
 *   It is lossless for what this document actually contains, opens everywhere,
 *   and converts cleanly to Word or LaTeX via Pandoc. The original UI offered
 *   an "Export to Word" button that did nothing; shipping a format that
 *   genuinely round-trips is more useful than a heavier one that half-works.
 *
 *   Only accepted prose is exported. Pending AI proposals are excluded by
 *   design — an unreviewed draft must never leave the app looking like
 *   finished work.
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

    const lines: string[] = [
      `# ${project.name}`,
      '',
      `*${project.document?.type ?? 'Document'} — exported ${formatDate(new Date())}*`,
      '',
    ];

    if (project.researchQuestion) {
      lines.push(`> **Research question:** ${project.researchQuestion}`, '');
    }

    for (const section of project.document?.sections ?? []) {
      lines.push(`## ${section.title}`, '');
      lines.push(section.userContent?.trim() || '*This section has not been written yet.*', '');
    }

    const papers = project.papers.filter((paper) => paper.status === 'ready');
    if (papers.length > 0) {
      lines.push('## Sources', '');
      for (const paper of papers) {
        const parts = [paper.authors, paper.year?.toString(), `*${paper.title}*`]
          .filter(Boolean)
          .join('. ');
        lines.push(`- ${parts}`);
      }
      lines.push('');
    }

    const body = lines.join('\n');

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
      console.error('[api/projects/export]', error);
    }

    return Response.json({ error: appError.message }, { status: appError.status });
  }
}
