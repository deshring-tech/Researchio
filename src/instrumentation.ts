import type { Instrumentation } from 'next';

/**
 * MODULE: instrumentation
 *
 * Purpose
 *   Server lifecycle hooks: startup logging, graceful shutdown, and a single
 *   funnel for uncaught server errors.
 *
 * Runtime guard
 *   `register` also runs in the Edge runtime, where node:process signals and
 *   Prisma are unavailable. Every Node-only import is therefore dynamic and
 *   guarded by `NEXT_RUNTIME`.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }

  const { logger } = await import('@/server/observability/logger');
  const { prisma } = await import('@/server/db/prisma');
  const { aiEnabled } = await import('@/server/ai/provider');

  logger.info('Server starting', {
    nodeEnv: process.env.NODE_ENV,
    aiConfigured: aiEnabled(),
  });

  /**
   * Graceful shutdown.
   *
   * SQLite is a file the process writes to directly, so being SIGKILLed
   * mid-write risks a torn database. Disconnecting Prisma first lets it finish
   * and close its handles. Container runtimes send SIGTERM and then wait
   * (docker-compose is configured for 30s), which is ample.
   */
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals) => {
    // Orchestrators sometimes send a second signal; re-entering here would
    // disconnect twice and throw during teardown.
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    logger.info('Shutting down', { signal });

    try {
      await prisma.$disconnect();
    } catch (error) {
      logger.error('Failed to close the database cleanly', error);
    }

    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // A rejected promise nobody awaited would otherwise terminate the process in
  // recent Node versions with no usable log line.
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', reason);
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', error);
  });
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
