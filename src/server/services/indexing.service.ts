import 'server-only';

import { prisma } from '@/server/db/prisma';
import { embedTexts } from '@/server/ai/provider';
import { logger } from '@/server/observability/logger';
import { chunkSpans, chunkText, normalizeExtractedText } from '@/lib/text/chunk';
import { pageRangeOf, type PageStart } from '@/lib/text/pages';
import { encodeEmbedding } from '@/lib/vector';

/**
 * MODULE: server/services/indexing
 *
 * Purpose
 *   Turn a source document's text into embedded, retrievable chunks.
 *
 * Responsibilities
 *   - Chunk text, embed each passage, and persist the vectors.
 *   - Record the pages each passage spans, so citations can name them.
 *   - Keep the index consistent with its source: reindexing replaces the
 *     previous chunks atomically rather than appending duplicates.
 *
 * Public: `indexNote`, `indexPaper`, `deleteChunksFor`
 */

interface IndexTarget {
  projectId: string;
  /** Exactly one of these identifies the owning source. */
  paperId?: string;
  noteId?: string;
}

interface Passage {
  content: string;
  pageStart: number | null;
  pageEnd: number | null;
}

/**
 * Embeds and stores passages, replacing any existing chunks for the target.
 *
 * The delete and the insert share a transaction, so a failure mid-way cannot
 * leave a source partially indexed and silently under-retrieved.
 *
 * Embedding happens *before* the transaction opens: it is a slow network call,
 * and holding a SQLite write transaction across it would block every other
 * writer for the duration.
 *
 * @returns Number of chunks written.
 */
async function replaceChunks(target: IndexTarget, passages: readonly Passage[]): Promise<number> {
  if (passages.length === 0) {
    await deleteChunksFor(target);
    return 0;
  }

  const vectors = await embedTexts(passages.map((passage) => passage.content));

  const rows = passages.map((passage, position) => ({
    projectId: target.projectId,
    paperId: target.paperId ?? null,
    noteId: target.noteId ?? null,
    content: passage.content,
    position,
    pageStart: passage.pageStart,
    pageEnd: passage.pageEnd,
    embedding: encodeEmbedding(vectors[position]),
  }));

  await prisma.$transaction(async (tx) => {
    await tx.chunk.deleteMany({ where: scopeOf(target) });
    await tx.chunk.createMany({ data: rows });
  });

  return rows.length;
}

function scopeOf(target: IndexTarget) {
  return target.paperId ? { paperId: target.paperId } : { noteId: target.noteId };
}

/** Removes every chunk belonging to a source. */
export async function deleteChunksFor(target: IndexTarget): Promise<void> {
  await prisma.chunk.deleteMany({ where: scopeOf(target) });
}

/**
 * Indexes a note so it becomes retrievable alongside uploaded papers.
 * A researcher's own observations are first-class evidence.
 */
export async function indexNote(params: {
  noteId: string;
  projectId: string;
  content: string;
}): Promise<number> {
  const passages = chunkText(params.content).map((content) => ({
    content,
    pageStart: null,
    pageEnd: null,
  }));

  return replaceChunks({ projectId: params.projectId, noteId: params.noteId }, passages);
}

export async function indexPaper(params: {
  paperId: string;
  projectId: string;
  text: string;
  pageStarts: readonly PageStart[] | null;
}): Promise<number> {
  const normalized = normalizeExtractedText(params.text);

  // Page offsets are only meaningful against the exact string they were
  // computed on. Text stored before normalization rules changed would shift
  // every offset, so its page information is discarded rather than attached to
  // the wrong pages — a missing page number is better than a false one.
  const pageStarts = normalized === params.text ? params.pageStarts : null;

  if (params.pageStarts && !pageStarts) {
    logger.warn('Discarding page offsets that no longer match the stored text', {
      paperId: params.paperId,
    });
  }

  const passages = chunkSpans(normalized).map((span) => ({
    content: span.content,
    ...(pageStarts
      ? pageRangeOf(pageStarts, span.start, span.end)
      : { pageStart: null, pageEnd: null }),
  }));

  return replaceChunks({ projectId: params.projectId, paperId: params.paperId }, passages);
}
