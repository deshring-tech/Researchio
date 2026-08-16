import 'server-only';

import { revalidatePath } from 'next/cache';

import { logger } from '@/server/observability/logger';
import { type ActionResult, isExpected, success, toActionFailure } from '@/lib/errors';

/**
 * MODULE: server/actions/runner
 *
 * Purpose
 *   Shared plumbing for Server Actions: uniform error handling and cache
 *   revalidation.
 *
 * Why a separate module
 *   A file carrying the `'use server'` directive may only export async
 *   functions, since every export becomes a callable endpoint. Helpers
 *   therefore live here and are imported by the action modules.
 *
 * Important
 *   Never call `redirect()` inside `run`. Next.js implements redirects by
 *   throwing a control-flow exception, which the catch below would swallow and
 *   report as a generic failure. Redirect *after* inspecting the result.
 */

/**
 * Executes an action body, converting thrown errors into a typed failure.
 *
 * @param context Label used in server logs for unexpected errors.
 */
export async function run<T>(
  context: string,
  body: () => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    return success(await body());
  } catch (error) {
    // Expected failures are the user's problem to fix and are already carried
    // back in the result. Anything else is ours, and must be recorded in full.
    if (!isExpected(error)) {
      logger.error('Server action failed', error, { action: context });
    }

    return toActionFailure(error);
  }
}

/**
 * Invalidates every cached route beneath a project.
 *
 * `'layout'` targets the whole subtree, so a mutation made in the notebook view
 * is reflected in the papers and document views too — those share the project
 * layout and would otherwise serve stale data after navigation.
 */
export function revalidateProject(projectId: string): void {
  revalidatePath(`/p/${projectId}`, 'layout');
}

/** Invalidates the project list shown in the workspace shell. */
export function revalidateWorkspace(): void {
  revalidatePath('/', 'layout');
}
