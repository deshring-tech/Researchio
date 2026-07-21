import { requireUser } from '@/server/auth/session';
import { getPaperForDownload } from '@/server/services/paper.service';
import { readUpload } from '@/server/storage/files';
import { AppError } from '@/lib/errors';

/**
 * ROUTE: GET /api/papers/[paperId]/file
 *
 * Purpose
 *   Serve an uploaded source document back to its owner.
 *
 * Why this is not a static file route
 *   Uploads live outside `public/` precisely so they are not world-readable.
 *   Serving them through a handler means every request is authenticated and
 *   ownership-checked; a static path would expose one user's sources to anyone
 *   who guessed the filename.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ paperId: string }> },
): Promise<Response> {
  try {
    const { paperId } = await context.params;
    const user = await requireUser();

    const paper = await getPaperForDownload(user.id, paperId);
    const bytes = await readUpload(paper.storageKey as string);

    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': paper.mimeType || 'application/octet-stream',
        // `inline` lets PDFs open in the browser viewer. The filename is
        // quoted and stripped of quotes to keep the header well-formed.
        'Content-Disposition': `inline; filename="${paper.originalName.replace(/"/g, '')}"`,
        'Content-Length': String(bytes.byteLength),
        // Private: this is per-user content and must never be held by a shared
        // cache or CDN.
        'Cache-Control': 'private, max-age=0, must-revalidate',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    const appError =
      error instanceof AppError ? error : new AppError('INTERNAL', 'Could not load the file.');

    if (!appError.expected) {
      console.error('[api/papers/file]', error);
    }

    return Response.json({ error: appError.message }, { status: appError.status });
  }
}
