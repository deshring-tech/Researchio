import path from 'node:path';

/**
 * MODULE: server/db/datasource
 *
 * Purpose
 *   Resolve `DATABASE_URL` into a single unambiguous connection string that the
 *   Prisma CLI and the application runtime both agree on.
 *
 * Why this exists
 *   The Prisma CLI resolves a relative `file:` URL against the directory
 *   containing `schema.prisma`, while a PrismaClient constructed at runtime
 *   resolves it against `process.cwd()`. Those differ, so the same
 *   `DATABASE_URL` silently produces two separate SQLite databases.
 *
 *   This module makes the runtime mirror the CLI: relative paths always resolve
 *   against the schema directory, and the result is absolute so no downstream
 *   caller can reinterpret it.
 *
 * Dependencies: node builtins only, so the Prisma CLI config loader can import
 *   it without the application's module aliases.
 */

const SQLITE_PREFIX = 'file:';
const DEFAULT_SQLITE_PATH = './dev.db';

/**
 * Repository root. `PROJECT_ROOT` lets deployments whose working directory is
 * not the repository root (e.g. Next.js standalone output) pin it explicitly.
 */
function projectRoot(): string {
  return process.env.PROJECT_ROOT?.trim() || process.cwd();
}

/**
 * Base directory for relative `file:` paths. This is the directory holding
 * `schema.prisma`, matching Prisma CLI behaviour.
 */
function schemaDirectory(): string {
  return path.resolve(projectRoot(), 'prisma');
}

/**
 * Normalizes a filesystem path into a form Prisma accepts on every platform.
 * Backslashes in a `file:` URL are not portable, so Windows paths are converted
 * to forward slashes.
 */
function toFileUrl(absolutePath: string): string {
  return SQLITE_PREFIX + absolutePath.replace(/\\/g, '/');
}

/**
 * Returns the connection string to hand to Prisma.
 *
 * Non-SQLite URLs (PostgreSQL, MySQL) are passed through untouched, so swapping
 * providers requires no change here.
 */
export function resolveDatasourceUrl(raw = process.env.DATABASE_URL): string {
  const value = raw?.trim();

  if (!value) {
    return toFileUrl(path.resolve(schemaDirectory(), DEFAULT_SQLITE_PATH));
  }

  if (!value.startsWith(SQLITE_PREFIX)) {
    return value;
  }

  const target = value.slice(SQLITE_PREFIX.length);
  if (path.isAbsolute(target)) {
    return toFileUrl(target);
  }

  return toFileUrl(path.resolve(schemaDirectory(), target));
}
