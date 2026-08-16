import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveDatasourceUrl } from '@/server/db/datasource';

/**
 * These guard the dual-database bug: the Prisma CLI resolves a relative `file:`
 * URL against the schema directory while a runtime client resolves it against
 * the working directory. When those disagree the application and the migration
 * tooling silently use two different databases.
 */

const originalRoot = process.env.PROJECT_ROOT;

afterEach(() => {
  if (originalRoot === undefined) {
    delete process.env.PROJECT_ROOT;
  } else {
    process.env.PROJECT_ROOT = originalRoot;
  }
});

describe('resolveDatasourceUrl', () => {
  it('resolves a relative path against the prisma directory, matching the CLI', () => {
    process.env.PROJECT_ROOT = path.resolve('/srv/app');

    expect(resolveDatasourceUrl('file:./dev.db')).toBe(
      `file:${path.resolve('/srv/app/prisma/dev.db').replace(/\\/g, '/')}`,
    );
  });

  it('always returns an absolute path, so no caller can reinterpret it', () => {
    process.env.PROJECT_ROOT = path.resolve('/srv/app');

    const resolved = resolveDatasourceUrl('file:./dev.db').slice('file:'.length);
    expect(path.isAbsolute(resolved)).toBe(true);
  });

  it('leaves an absolute sqlite path untouched', () => {
    const absolute = path.resolve('/data/researchio.db').replace(/\\/g, '/');
    expect(resolveDatasourceUrl(`file:${absolute}`)).toBe(`file:${absolute}`);
  });

  it('uses forward slashes so the URL is portable off Windows', () => {
    process.env.PROJECT_ROOT = 'C:\\Researchio';
    expect(resolveDatasourceUrl('file:./dev.db')).not.toContain('\\');
  });

  it('passes a PostgreSQL URL through unchanged', () => {
    // Switching providers must require no change to this module.
    const url = 'postgresql://user:pass@localhost:5432/researchio?schema=public';
    expect(resolveDatasourceUrl(url)).toBe(url);
  });

  it('passes a MySQL URL through unchanged', () => {
    const url = 'mysql://user:pass@localhost:3306/researchio';
    expect(resolveDatasourceUrl(url)).toBe(url);
  });

  it('falls back to the default database when unset', () => {
    process.env.PROJECT_ROOT = path.resolve('/srv/app');
    expect(resolveDatasourceUrl(undefined)).toContain('prisma/dev.db');
  });

  it('treats an empty or whitespace value as unset', () => {
    process.env.PROJECT_ROOT = path.resolve('/srv/app');
    expect(resolveDatasourceUrl('   ')).toContain('prisma/dev.db');
  });

  it('trims surrounding whitespace from a supplied URL', () => {
    process.env.PROJECT_ROOT = path.resolve('/srv/app');
    expect(resolveDatasourceUrl('  file:./dev.db  ')).toContain('prisma/dev.db');
  });
});
