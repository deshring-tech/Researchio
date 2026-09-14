import { aiEnabled } from '@/server/ai/provider';
import { prisma } from '@/server/db/prisma';
import { logger } from '@/server/observability/logger';

/**
 * MODULE: instrumentation-node
 *
 * Purpose
 *   Node.js-only server setup: startup logging, graceful shutdown, and
 *   process-level error capture.
 *
 * Loaded exclusively from `instrumentation.ts` when `NEXT_RUNTIME` is `nodejs`,
 * so the Edge build never sees the Node APIs used here.
 *
 * Public: `registerNodeRuntime`
 */

let registered = false;

export function registerNodeRuntime(): void {
  // Development hot reload can evaluate instrumentation more than once; a
  // second set of listeners would run shutdown twice.
  if (registered) {
    return;
  }
  registered = true;

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
