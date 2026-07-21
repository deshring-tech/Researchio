import 'server-only';

import { PrismaClient } from '@prisma/client';
import { resolveDatasourceUrl } from './datasource';

/**
 * MODULE: server/db/prisma
 *
 * Purpose
 *   Provide the single shared PrismaClient instance.
 *
 * Notes
 *   The client is cached on `globalThis` in development because Next.js hot
 *   reload re-evaluates modules, and a fresh client per reload exhausts the
 *   database connection pool. The datasource URL is resolved explicitly so the
 *   runtime and the Prisma CLI always target the same database.
 */

declare global {
  var __researchioPrisma: PrismaClient | undefined;
}

function createClient(): PrismaClient {
  return new PrismaClient({
    datasourceUrl: resolveDatasourceUrl(),
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

export const prisma: PrismaClient = globalThis.__researchioPrisma ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__researchioPrisma = prisma;
}
