import 'server-only';

import { z } from 'zod';

import { prisma } from '@/server/db/prisma';
import { aiEnabled, generateJson } from '@/server/ai/provider';
import { PAPER_ANALYSIS_JSON_SCHEMA, paperAnalysisPrompt } from '@/server/ai/prompts';
import { extractText } from '@/server/ingestion/extract';
import { deleteUpload, readUpload, saveUpload } from '@/server/storage/files';
import { deleteChunksFor, indexPaper } from '@/server/services/indexing.service';
import { assertProjectAccess, touchProject } from '@/server/services/project.service';
import { recordEvent } from '@/server/services/timeline.service';
import { logger } from '@/server/observability/logger';
import { parsePageStarts } from '@/lib/text/pages';
import { AppError, notFound } from '@/lib/errors';
import type { IngestionStatus } from '@/lib/domain/constants';

/**
 * MODULE: server/services/paper
 *
 * Purpose
 *   Upload, ingest, list and delete source documents.
 *
 * Ingestion model
 *   Upload responds as soon as the file is safely on disk and the row exists.
 *   The expensive work — text extraction, embedding, analysis — runs afterwards
 *   and drives a `status` column the UI polls. Doing it inline would exceed
 *   request timeouts on any real paper.
 *
 *   This is deliberately an in-process background task rather than a queue. It
 *   suits a single-node deployment and adds no infrastructure; the cost is that
 *   a process restart mid-ingestion strands a row in `processing`, which
 *   `recoverStalledPapers` repairs on next access.
 *
 * Public: `uploadPaper`, `ingestPaper`, `retryPaper`, `deletePaper`,
 *   `recoverStalledPapers`
 */

/** A paper stuck in `processing` for longer than this is presumed abandoned. */
const STALL_TIMEOUT_MS = 10 * 60 * 1000;

const analysisSchema = z.object({
  title: z.string(),
  authors: z.string(),
  year: z.number().int(),
  plainSummary: z.string(),
  techSummary: z.string(),
  keyFindings: z.string(),
  methodology: z.string(),
  limitations: z.string(),
});

async function setStatus(
  paperId: string,
  status: IngestionStatus,
  statusMessage: string | null = null,
): Promise<void> {
  await prisma.paper.update({
    where: { id: paperId },
    data: { status, statusMessage },
  });
}

/** Strips the extension to form a readable placeholder title. */
function titleFromFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || filename;
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

/**
 * Stores an uploaded file and creates its paper record.
 *
 * Ingestion is *not* awaited — the caller triggers it so the user gets an
 * immediate response.
 */
export async function uploadPaper(
  userId: string,
  input: { projectId: string; file: File },
) {
  await assertProjectAccess(input.projectId, userId);

  const stored = await saveUpload(input.file);

  try {
    const paper = await prisma.paper.create({
      data: {
        projectId: input.projectId,
        title: titleFromFilename(input.file.name),
        originalName: input.file.name,
        mimeType: input.file.type || 'application/octet-stream',
        sizeBytes: stored.sizeBytes,
        storageKey: stored.storageKey,
        status: 'pending',
      },
      select: { id: true, title: true },
    });

    await recordEvent({
      projectId: input.projectId,
      type: 'PAPER_UPLOADED',
      description: `Uploaded "${input.file.name}"`,
    });

    await touchProject(input.projectId);

    return paper;
  } catch (error) {
    // The row failed, so the file on disk is now orphaned. Remove it.
    await deleteUpload(stored.storageKey);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Ingestion pipeline
// ---------------------------------------------------------------------------

/**
 * Runs the full ingestion pipeline for one paper.
 *
 * Never throws: every outcome is recorded in the paper's `status`, because this
 * runs detached from any request that could surface an exception.
 */
export async function ingestPaper(paperId: string): Promise<void> {
  const paper = await prisma.paper.findUnique({
    where: { id: paperId },
    select: {
      id: true,
      projectId: true,
      originalName: true,
      mimeType: true,
      storageKey: true,
      extractedText: true,
      pageStarts: true,
    },
  });

  if (!paper?.storageKey) {
    return;
  }

  try {
    await setStatus(paperId, 'processing');

    const isPdf =
      paper.mimeType === 'application/pdf' || paper.originalName.toLowerCase().endsWith('.pdf');

    // Reuse text from a previous run rather than re-parsing — except for a PDF
    // extracted before page tracking, where re-parsing is the only way to give
    // its citations page numbers.
    let text = paper.extractedText;
    let pageStarts = parsePageStarts(paper.pageStarts);

    if (!text || (isPdf && !pageStarts)) {
      const bytes = await readUpload(paper.storageKey);
      const extracted = await extractText({
        bytes,
        mimeType: paper.mimeType,
        originalName: paper.originalName,
      });

      text = extracted.text;
      pageStarts = extracted.pageStarts;

      await prisma.paper.update({
        where: { id: paperId },
        data: {
          extractedText: text,
          pageCount: extracted.pageCount,
          pageStarts: pageStarts ? JSON.stringify(pageStarts) : null,
        },
      });
    }

    if (!aiEnabled()) {
      // The document is readable, but cannot be indexed or analysed yet.
      // Left pending so that configuring a key and retrying completes it.
      await setStatus(
        paperId,
        'pending',
        'Text extracted. Add GEMINI_API_KEY and retry to enable search and analysis.',
      );
      return;
    }

    await indexPaper({ paperId, projectId: paper.projectId, text, pageStarts });
    await analysePaper(paperId, paper.originalName, text);

    await setStatus(paperId, 'ready');

    await recordEvent({
      projectId: paper.projectId,
      type: 'PAPER_READY',
      description: `Finished analysing "${paper.originalName}"`,
    });
  } catch (error) {
    const message =
      error instanceof AppError && error.expected
        ? error.message
        : 'Processing failed unexpectedly. Try again, or re-upload the file.';

    if (!(error instanceof AppError && error.expected)) {
      logger.error('Ingestion failed unexpectedly', error, { paperId });
    }

    await setStatus(paperId, 'failed', message).catch(() => undefined);

    await recordEvent({
      projectId: paper.projectId,
      type: 'PAPER_FAILED',
      description: `Could not process "${paper.originalName}"`,
    });
  }
}

/**
 * Generates and stores the structured analysis for a paper.
 *
 * Analysis failure is not fatal to ingestion: a searchable paper without
 * summaries is far more useful than a failed upload, so the error is logged and
 * the pipeline continues.
 */
async function analysePaper(paperId: string, filename: string, text: string): Promise<void> {
  try {
    const analysis = await generateJson(
      paperAnalysisPrompt({ fallbackTitle: titleFromFilename(filename), text }),
      PAPER_ANALYSIS_JSON_SCHEMA as unknown as Record<string, unknown>,
      analysisSchema,
    );

    await prisma.paper.update({
      where: { id: paperId },
      data: {
        title: analysis.title.trim() || titleFromFilename(filename),
        authors: analysis.authors.trim() || null,
        year: analysis.year > 0 ? analysis.year : null,
        plainSummary: analysis.plainSummary.trim() || null,
        techSummary: analysis.techSummary.trim() || null,
        keyFindings: analysis.keyFindings.trim() || null,
        methodology: analysis.methodology.trim() || null,
        limitations: analysis.limitations.trim() || null,
      },
    });
  } catch (error) {
    logger.warn('Analysis failed; the paper remains searchable', { paperId, error });
  }
}

/**
 * Starts ingestion without blocking the caller.
 *
 * `void` on the promise is intentional and safe: `ingestPaper` handles all of
 * its own errors, so there is no unhandled rejection to leak.
 */
export function startIngestion(paperId: string): void {
  void ingestPaper(paperId);
}

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

export async function retryPaper(userId: string, paperId: string): Promise<string> {
  const paper = await prisma.paper.findUnique({
    where: { id: paperId },
    select: { id: true, projectId: true },
  });

  if (!paper) {
    throw notFound('Document');
  }

  await assertProjectAccess(paper.projectId, userId);
  await setStatus(paperId, 'pending', null);
  startIngestion(paperId);

  return paper.projectId;
}

/**
 * Requeues papers left mid-ingestion by a process restart, and resumes any that
 * are waiting on AI configuration.
 *
 * Called when a project is opened, which is the natural moment to reconcile.
 */
export async function recoverStalledPapers(projectId: string): Promise<void> {
  const stalled = await prisma.paper.findMany({
    where: {
      projectId,
      OR: [
        { status: 'processing', updatedAt: { lt: new Date(Date.now() - STALL_TIMEOUT_MS) } },
        ...(aiEnabled() ? [{ status: 'pending' as const }] : []),
      ],
    },
    select: { id: true },
    take: 5,
  });

  for (const paper of stalled) {
    startIngestion(paper.id);
  }
}

export async function deletePaper(userId: string, paperId: string): Promise<string> {
  const paper = await prisma.paper.findUnique({
    where: { id: paperId },
    select: { id: true, projectId: true, originalName: true, storageKey: true },
  });

  if (!paper) {
    throw notFound('Document');
  }

  await assertProjectAccess(paper.projectId, userId);

  await deleteChunksFor({ projectId: paper.projectId, paperId: paper.id });
  await prisma.paper.delete({ where: { id: paperId } });

  if (paper.storageKey) {
    await deleteUpload(paper.storageKey);
  }

  await recordEvent({
    projectId: paper.projectId,
    type: 'PAPER_DELETED',
    description: `Removed "${paper.originalName}"`,
  });

  return paper.projectId;
}

export async function getPaperForDownload(userId: string, paperId: string) {
  const paper = await prisma.paper.findUnique({
    where: { id: paperId },
    select: {
      id: true,
      projectId: true,
      originalName: true,
      mimeType: true,
      storageKey: true,
    },
  });

  if (!paper?.storageKey) {
    throw notFound('Document');
  }

  await assertProjectAccess(paper.projectId, userId);
  return paper;
}
