'use server';

import { requireUser } from '@/server/auth/session';
import {
  acceptDraft,
  addSection,
  deleteSection,
  discardDraft,
  draftSection,
  moveSection,
  setSectionStatus,
  updateSectionContent,
} from '@/server/services/document.service';
import { assertSectionAccess } from '@/server/services/project.service';
import { requestClaimCheck, startClaimCheck } from '@/server/services/verification.service';
import { RATE_LIMITS, consume } from '@/server/security/rate-limit';
import { revalidateProject, run } from '@/server/actions/runner';
import {
  checkClaimsSchema,
  createSectionSchema,
  parseFormData,
  reorderSectionSchema,
  sectionIdSchema,
  setSectionStatusSchema,
  updateSectionSchema,
} from '@/lib/validation/schemas';
import { AppError, type ActionResult } from '@/lib/errors';

/**
 * MODULE: server/actions/document
 *
 * Purpose
 *   Living Document entry points: drafting, review decisions and outline
 *   editing.
 */

export async function draftSectionAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  const result = await run('document.draft', async () => {
    const user = await requireUser();
    const { sectionId } = parseFormData(sectionIdSchema, formData);
    // Resolves the owning project and authorizes in one step; `draftSection`
    // returns the prose rather than the id needed for revalidation.
    const projectId = await assertSectionAccess(sectionId, user.id);

    // Drafting retrieves ten passages and runs a long generation, making it the
    // costliest call in the app. Rate limited per user so a held-down button or
    // a leaked session cannot drain the provider quota.
    const limit = consume(`draft:${user.id}`, RATE_LIMITS.draft);
    if (!limit.ok) {
      throw new AppError(
        'RATE_LIMITED',
        `Too many drafts requested. Try again in ${limit.retryAfterSeconds} seconds.`,
      );
    }

    await draftSection(user.id, sectionId);

    // Hallucination enters at drafting, so every draft is checked before the
    // researcher decides whether to accept it.
    await startClaimCheck(sectionId, 'draft');
    return projectId;
  });

  if (!result.ok) {
    return result;
  }

  revalidateProject(result.data);
  return { ok: true, data: undefined };
}

export async function acceptDraftAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  const result = await run('document.accept', async () => {
    const user = await requireUser();
    const { sectionId } = parseFormData(sectionIdSchema, formData);
    const projectId = await acceptDraft(user.id, sectionId);

    // Verdicts already reached for the draft are reused, so checking the merged
    // prose only costs a model call for claims that were not in it.
    await startClaimCheck(sectionId, 'document');
    return projectId;
  });

  if (!result.ok) {
    return result;
  }

  revalidateProject(result.data);
  return { ok: true, data: undefined };
}

export async function discardDraftAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  const result = await run('document.discard', async () => {
    const user = await requireUser();
    const { sectionId } = parseFormData(sectionIdSchema, formData);
    return discardDraft(user.id, sectionId);
  });

  if (!result.ok) {
    return result;
  }

  revalidateProject(result.data);
  return { ok: true, data: undefined };
}

export async function updateSectionAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  const result = await run('document.updateSection', async () => {
    const user = await requireUser();
    const input = parseFormData(updateSectionSchema, formData);
    const projectId = await updateSectionContent(user.id, input);

    // Only claims whose wording or evidence changed reach the model.
    await startClaimCheck(input.sectionId, 'document');
    return projectId;
  });

  if (!result.ok) {
    return result;
  }

  revalidateProject(result.data);
  return { ok: true, data: undefined };
}

export async function setSectionStatusAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  const result = await run('document.setStatus', async () => {
    const user = await requireUser();
    const input = parseFormData(setSectionStatusSchema, formData);
    return setSectionStatus(user.id, input);
  });

  if (!result.ok) {
    return result;
  }

  revalidateProject(result.data);
  return { ok: true, data: undefined };
}

export async function addSectionAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  const result = await run('document.addSection', async () => {
    const user = await requireUser();
    const input = parseFormData(createSectionSchema, formData);
    return addSection(user.id, input);
  });

  if (!result.ok) {
    return result;
  }

  revalidateProject(result.data);
  return { ok: true, data: undefined };
}

export async function deleteSectionAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  const result = await run('document.deleteSection', async () => {
    const user = await requireUser();
    const { sectionId } = parseFormData(sectionIdSchema, formData);
    return deleteSection(user.id, sectionId);
  });

  if (!result.ok) {
    return result;
  }

  revalidateProject(result.data);
  return { ok: true, data: undefined };
}

export async function moveSectionAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  const result = await run('document.moveSection', async () => {
    const user = await requireUser();
    const input = parseFormData(reorderSectionSchema, formData);
    return moveSection(user.id, input);
  });

  if (!result.ok) {
    return result;
  }

  revalidateProject(result.data);
  return { ok: true, data: undefined };
}

export async function checkClaimsAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  const result = await run('document.checkClaims', async () => {
    const user = await requireUser();
    const { sectionId, target } = parseFormData(checkClaimsSchema, formData);

    const limit = consume(`verify:${user.id}`, RATE_LIMITS.verify);
    if (!limit.ok) {
      throw new AppError(
        'RATE_LIMITED',
        `Too many checks requested. Try again in ${limit.retryAfterSeconds} seconds.`,
      );
    }

    return requestClaimCheck(user.id, sectionId, target);
  });

  if (!result.ok) {
    return result;
  }

  revalidateProject(result.data);
  return { ok: true, data: undefined };
}
