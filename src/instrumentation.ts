import type { Instrumentation } from 'next';

/**
 * MODULE: instrumentation
 *
 * Purpose
 *   Server lifecycle hooks: startup, graceful shutdown, and a single funnel for
 *   uncaught server errors.
 *
 * Runtime split
 *   Next.js calls `register` in every runtime, including Edge, where
 *   `process.on` and Prisma do not exist. Node-only setup therefore lives in
 *   `instrumentation-node.ts` and is imported only on the Node runtime, as the
 *   Next.js instrumentation guide prescribes. A runtime check around inline code
 *   is not enough: the bundler still traces those Node APIs into the Edge build
 *   and reports them as errors.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerNodeRuntime } = await import('./instrumentation-node');
    registerNodeRuntime();
  }
}

/**
 * Captures errors Next.js surfaces from rendering and route handling.
 *
 * This is where an external error tracker (Sentry, Bugsnag) would be wired in;
 * until then the structured log is the record.
 */
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  const { logger } = await import('@/server/observability/logger');

  logger.error('Unhandled server error', error, {
    path: request.path,
    method: request.method,
    routerKind: context.routerKind,
    routePath: context.routePath,
    renderSource: context.renderSource,
  });
};
