'use server';

import { redirect } from 'next/navigation';

import { requireUser } from '@/server/auth/session';
import {
  createProject,
  deleteProject,
  updateProject,
} from '@/server/services/project.service';
import { deleteUploads } from '@/server/storage/files';
import { revalidateProject, revalidateWorkspace, run } from '@/server/actions/runner';
import {
  createProjectSchema,
  parseFormData,
  projectIdSchema,
  updateProjectSchema,
} from '@/lib/validation/schemas';
import type { ActionResult } from '@/lib/errors';

/**
 * MODULE: server/actions/project
 *
 * Purpose
 *   Project lifecycle entry points for the workspace UI.
 *
 * Control flow
 *   Each action returns early on failure so the form can render the message.
 *   `redirect()` is reached only on success, and never runs inside `run()`
 *   where its control-flow exception would be caught and misreported.
 */

export async function createProjectAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  const result = await run('project.create', async () => {
    const user = await requireUser();
    const input = parseFormData(createProjectSchema, formData);
    const project = await createProject(user.id, input);
    return project.id;
  });

  if (!result.ok) {
    return result;
  }

  revalidateWorkspace();
  redirect(`/p/${result.data}`);
}

export async function updateProjectAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  const result = await run('project.update', async () => {
    const user = await requireUser();
    const input = parseFormData(updateProjectSchema, formData);
    await updateProject(input.projectId, user.id, input);
    return input.projectId;
  });

  if (!result.ok) {
    return result;
  }

  revalidateProject(result.data);
  revalidateWorkspace();
  return { ok: true, data: undefined };
}

export async function deleteProjectAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  const result = await run('project.delete', async () => {
    const user = await requireUser();
    const { projectId } = parseFormData(projectIdSchema, formData);

    // The service returns storage keys rather than touching the filesystem
    // itself, so file cleanup happens here, once the rows are gone.
    const storageKeys = await deleteProject(projectId, user.id);
    await deleteUploads(storageKeys);
  });

  if (!result.ok) {
    return result;
  }

  revalidateWorkspace();
  redirect('/');
}
