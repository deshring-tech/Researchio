import 'server-only';

import type { Prisma } from '@prisma/client';

import { prisma } from '@/server/db/prisma';
import { logger } from '@/server/observability/logger';
import type { TimelineEventType } from '@/lib/domain/constants';

/**
 * MODULE: server/services/timeline
 *
 * Purpose
 *   Record the audit trail of activity within a project.
 *
 * Notes
 *   Timeline writes are deliberately non-fatal. Losing an activity entry must
 *   never roll back the note the researcher actually wrote, so `recordEvent`
 *   swallows its own failures unless it is given an explicit transaction
 *   client, in which case the caller owns the error handling.
 */

export interface RecordEventInput {
  projectId: string;
  type: TimelineEventType;
  description: string;
}

type Client = Prisma.TransactionClient | typeof prisma;

/** Records an event inside an existing transaction. Failures propagate. */
export function recordEventWith(client: Client, input: RecordEventInput) {
  return client.timelineEvent.create({
    data: {
      projectId: input.projectId,
      type: input.type,
      description: input.description,
    },
  });
}

/** Records an event as a standalone write. Failures are logged, not thrown. */
export async function recordEvent(input: RecordEventInput): Promise<void> {
  try {
    await recordEventWith(prisma, input);
  } catch (error) {
    logger.warn('Failed to record timeline event', {
      projectId: input.projectId,
      type: input.type,
      error,
    });
  }
}

export async function listEvents(projectId: string, limit = 40) {
  return prisma.timelineEvent.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}
