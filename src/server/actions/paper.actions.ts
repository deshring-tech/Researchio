'use server';

import { requireUser } from '@/server/auth/session';
import {
  deletePaper,
  retryPaper,
  startIngestion,
  uploadPaper,
} from '@/server/services/paper.service';
import { revalidateProject, run } from '@/server/actions/runner';
import { logger } from '@/server/observability/logger';
import { paperIdSchema, parseFormData, parseInput, projectIdSchema } from '@/lib/validation/schemas';
import { AppError, type ActionResult } from '@/lib/errors';

/**
 * MODULE: server/actions/paper
 *
 * Purpose
 *   Upload, retry and delete source documents.
 *
 * Upload semantics
 *   Files are processed one at a time and reported individually, so one
 *   unreadable PDF in a batch of ten does not discard the other nine. The
 *   result names which files failed and why.
 */

export interface UploadOutcome {
  accepted: number;
  failures: Array<{ name: string; reason: string }>;
}

export async function uploadPapersAction(
  _previous: ActionResult<UploadOutcome> | null,
  formData: FormData,
): Promise<ActionResult<UploadOutcome>> {
  const result = await run('paper.upload', async () => {
    const user = await requireUser();
    const { projectId } = parseInput(projectIdSchema, {
      projectId: formData.get('projectId'),
    });

    const files = formData.getAll('files').filter((entry): entry is File => entry instanceof File);

    if (files.length === 0) {
      throw new AppError('VALIDATION', 'Choose at least one file to upload.');
    }

    const outcome: UploadOutcome = { accepted: 0, failures: [] };

    for (const file of files) {
      try {
        const paper = await uploadPaper(user.id, { projectId, file });
        // Ingestion runs detached; the UI polls the paper's status.
        startIngestion(paper.id);
        outcome.accepted += 1;
      } catch (error) {
        const reason =
          error instanceof AppError && error.expected
            ? error.message
            : 'Could not be stored.';

        if (!(error instanceof AppError && error.expected)) {
          logger.error('Upload failed unexpectedly', error, { filename: file.name });
        }

        outcome.failures.push({ name: file.name, reason });
      }
    }

    return { projectId, outcome };
  });

  if (!result.ok) {
    return result;
  }

  revalidateProject(result.data.projectId);
  return { ok: true, data: result.data.outcome };
}

export async function retryPaperAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  const result = await run('paper.retry', async () => {
    const user = await requireUser();
    const { paperId } = parseFormData(paperIdSchema, formData);
    return retryPaper(user.id, paperId);
  });

  if (!result.ok) {
    return result;
  }

  revalidateProject(result.data);
  return { ok: true, data: undefined };
}

export async function deletePaperAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  const result = await run('paper.delete', async () => {
    const user = await requireUser();
    const { paperId } = parseFormData(paperIdSchema, formData);
    return deletePaper(user.id, paperId);
  });

  if (!result.ok) {
    return result;
  }

  revalidateProject(result.data);
  return { ok: true, data: undefined };
}
