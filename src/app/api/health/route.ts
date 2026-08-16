import { prisma } from '@/server/db/prisma';
import { aiEnabled } from '@/server/ai/provider';
import { env } from '@/server/config/env';
import { logger } from '@/server/observability/logger';

/**
 * ROUTE: GET /api/health
 *
 * Purpose
 *   Readiness probe for container orchestrators, load balancers and uptime
 *   monitors.
 *
 * What it checks
 *   That the process can actually reach its database and its upload directory.
 *   A liveness check that only proves the event loop is running would keep a
 *   broken instance in the load-balancer rotation, which is worse than no
 *   check at all.
 *
 *   AI configuration is reported but never fails the probe: the app is
 *   designed to run in a degraded mode without a provider key, and taking an
 *   instance out of rotation for that would be wrong.
 *
 * Auth
 *   Intentionally public, since probes run before any session exists. The
 *   response carries no user data, no configuration values and no version
 *   details that would help an attacker.
 */

// Never cached or prerendered: a cached health check reports the past.
export const dynamic = 'force-dynamic';

const TIMEOUT_MS = 5_000;

async function withTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function checkDatabase(): Promise<{ ok: boolean; latencyMs: number }> {
  const startedAt = Date.now();
  await withTimeout(prisma.$queryRaw`SELECT 1`, 'database check');
  return { ok: true, latencyMs: Date.now() - startedAt };
}

async function checkUploads(): Promise<boolean> {
  const { access, mkdir } = await import('node:fs/promises');

  // Create on first probe rather than only reading: on a freshly mounted
  // volume the directory legitimately does not exist yet, and reporting
  // unhealthy for that would block a correct deployment from ever starting.
  try {
    await access(env.uploads.directory);
    return true;
  } catch {
    await mkdir(env.uploads.directory, { recursive: true });
    return true;
  }
}

export async function GET(): Promise<Response> {
  const checks: Record<string, unknown> = {};
  let healthy = true;

  try {
    checks.database = await checkDatabase();
  } catch (error) {
    healthy = false;
    checks.database = { ok: false };
    logger.error('Health check: database unreachable', error);
  }

  try {
    checks.uploads = { ok: await checkUploads() };
  } catch (error) {
    healthy = false;
    checks.uploads = { ok: false };
    logger.error('Health check: upload directory unusable', error);
  }

  checks.ai = { configured: aiEnabled() };

  return Response.json(
    {
      status: healthy ? 'ok' : 'unhealthy',
      uptimeSeconds: Math.round(process.uptime()),
      checks,
    },
    {
      status: healthy ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
