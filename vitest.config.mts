import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration.
 *
 * Scope: pure modules only — chunking, vectors, checklist rules, password
 * hashing, validation and datasource resolution. Anything needing a database or
 * a live server is covered by `scripts/verify.ts`, which exercises the real
 * stack rather than mocks of it.
 *
 * The `.mts` extension is deliberate: this package is CommonJS, so a `.ts`
 * config is loaded as CJS and Vite warns about the ESM syntax within it.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],

    // scrypt is intentionally slow; the default 5s timeout is marginal for the
    // hashing tests on a loaded CI runner.
    testTimeout: 20_000,

    coverage: {
      provider: 'v8',
      include: ['src/lib/**', 'src/server/auth/password.ts', 'src/server/db/datasource.ts'],
      reporter: ['text', 'lcov'],
    },

    /**
     * Modules under test import `server-only`, whose default build throws to
     * stop server code reaching the client bundle. Resolving with the
     * `react-server` condition selects its no-op build, exactly as Next.js does
     * when rendering a Server Component.
     */
    server: {
      deps: { inline: ['server-only'] },
    },
  },

  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
    conditions: ['react-server', 'node', 'import', 'default'],
  },

  ssr: {
    resolve: {
      conditions: ['react-server', 'node', 'import', 'default'],
    },
  },
});
