import 'server-only';

import { prisma } from '@/server/db/prisma';
import { assertProjectAccess, touchProject } from '@/server/services/project.service';
import { deleteChunksFor, indexNote } from '@/server/services/indexing.service';
import { recordEvent } from '@/server/services/timeline.service';
import { aiEnabled } from '@/server/ai/provider';
import { logger } from '@/server/observability/logger';
import { notFound } from '@/lib/errors';

/**
 * MODULE: server/services/note
 *
 * Purpose
 *   Create, list and delete research notes, keeping the retrieval index in sync.
 *
 * Design note
 *   Saving a note never depends on the AI provider. Indexing is attempted after
 *   the note is committed and its failure is logged, not propagated — a
 *   researcher must never lose a thought because an embedding API was rate
 *   limited. Unindexed notes are picked up by `reindexPendingNotes`.
 *
 * Public: `createNote`, `deleteNote`, `reindexPendingNotes`
 */

export async function createNote(
  userId: string,
  input: { projectId: string; content: string },
) {
  await assertProjectAccess(input.projectId, userId);

  const note = await prisma.note.create({
    data: { projectId: input.projectId, content: input.content },
  });

  await recordEvent({
    projectId: input.projectId,
    type: 'NOTE_ADDED',
    description: summarize(input.content),
  });

  await touchProject(input.projectId);

  if (aiEnabled()) {
    try {
      await indexNote({
        noteId: note.id,
        projectId: input.projectId,
        content: input.content,
      });
    } catch (error) {
      logger.warn('Note saved but not indexed; retried when the project is next opened', {
        noteId: note.id,
        error,
      });
    }
  }

  return note;
}

export async function deleteNote(userId: string, noteId: string): Promise<string> {
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    select: { id: true, projectId: true, content: true },
  });

  if (!note) {
    throw notFound('Note');
  }

  await assertProjectAccess(note.projectId, userId);

  await deleteChunksFor({ projectId: note.projectId, noteId: note.id });
  await prisma.note.delete({ where: { id: noteId } });

  await recordEvent({
    projectId: note.projectId,
    type: 'NOTE_DELETED',
    description: `Deleted note: ${summarize(note.content)}`,
  });

  return note.projectId;
}

/**
 * Indexes notes that were saved while the AI provider was unavailable.
 *
 * Invoked opportunistically when a project is opened, so adding an API key
 * retroactively makes existing notes searchable without a manual migration.
 *
 * @returns Number of notes newly indexed.
 */
export async function reindexPendingNotes(projectId: string, limit = 25): Promise<number> {
  if (!aiEnabled()) {
    return 0;
  }

  const pending = await prisma.note.findMany({
    where: { projectId, chunks: { none: {} } },
    select: { id: true, content: true },
    take: limit,
  });

  let indexed = 0;
  for (const note of pending) {
    try {
      await indexNote({ noteId: note.id, projectId, content: note.content });
      indexed += 1;
    } catch (error) {
      logger.warn('Backfill indexing failed; stopping this pass', { noteId: note.id, error });
      // Stop on first failure: if the provider is down, the rest will fail too.
      break;
    }
  }

  return indexed;
}

/** First line of a note, truncated, for timeline descriptions. */
function summarize(content: string, maxLength = 80): string {
  const firstLine = content.trim().split('\n')[0] ?? '';
  return firstLine.length > maxLength ? `${firstLine.slice(0, maxLength - 1)}…` : firstLine;
}
