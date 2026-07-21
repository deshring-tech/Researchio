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
import { revalidateProject, run } from '@/server/actions/runner';
import {
  createSectionSchema,
  parseFormData,
  reorderSectionSchema,
  sectionIdSchema,
  setSectionStatusSchema,
  updateSectionSchema,
} from '@/lib/validation/schemas';
import type { ActionResult } from '@/lib/errors';

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
    await draftSection(user.id, sectionId);
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
    return acceptDraft(user.id, sectionId);
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
    return updateSectionContent(user.id, input);
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
