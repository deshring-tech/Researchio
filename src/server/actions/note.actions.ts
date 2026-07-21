'use server';

import { requireUser } from '@/server/auth/session';
import { createNote, deleteNote } from '@/server/services/note.service';
import { revalidateProject, run } from '@/server/actions/runner';
import { createNoteSchema, noteIdSchema, parseFormData } from '@/lib/validation/schemas';
import type { ActionResult } from '@/lib/errors';

/** MODULE: server/actions/note — capture and removal of research notes. */

export async function createNoteAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  const result = await run('note.create', async () => {
    const user = await requireUser();
    const input = parseFormData(createNoteSchema, formData);
    await createNote(user.id, input);
    return input.projectId;
  });

  if (!result.ok) {
    return result;
  }

  revalidateProject(result.data);
  return { ok: true, data: undefined };
}

export async function deleteNoteAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  const result = await run('note.delete', async () => {
    const user = await requireUser();
    const { noteId } = parseFormData(noteIdSchema, formData);
    return deleteNote(user.id, noteId);
  });

  if (!result.ok) {
    return result;
  }

  revalidateProject(result.data);
  return { ok: true, data: undefined };
}
