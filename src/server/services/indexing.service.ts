import 'server-only';

import { prisma } from '@/server/db/prisma';
import { embedTexts } from '@/server/ai/provider';
import { chunkText } from '@/lib/text/chunk';
import { encodeEmbedding } from '@/lib/vector';

/**
 * MODULE: server/services/indexing
 *
 * Purpose
 *   Turn a source document's text into embedded, retrievable chunks.
 *
 * Responsibilities
 *   - Chunk text, embed each passage, and persist the vectors.
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

/**
 * Chunks, embeds and stores `text`, replacing any existing chunks for the
 * target.
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
async function replaceChunks(target: IndexTarget, text: string): Promise<number> {
  const passages = chunkText(text);

  if (passages.length === 0) {
    await deleteChunksFor(target);
    return 0;
  }

  const vectors = await embedTexts(passages);

  const rows = passages.map((content, position) => ({
    projectId: target.projectId,
    paperId: target.paperId ?? null,
    noteId: target.noteId ?? null,
    content,
    position,
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
  return replaceChunks({ projectId: params.projectId, noteId: params.noteId }, params.content);
}

export async function indexPaper(params: {
  paperId: string;
  projectId: string;
  text: string;
}): Promise<number> {
  return replaceChunks({ projectId: params.projectId, paperId: params.paperId }, params.text);
}
