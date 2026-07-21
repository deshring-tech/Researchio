import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI configuration.
 *
 * The datasource URL comes from `env("DATABASE_URL")` in `prisma/schema.prisma`,
 * which takes precedence over anything declared here — so it is deliberately
 * not duplicated in this file. The application runtime mirrors the CLI's
 * relative-path semantics in `src/server/db/datasource.ts`.
 *
 * `dotenv/config` is imported because Prisma skips its own .env loading as soon
 * as a config file is present.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'npx tsx prisma/seed.ts',
  },
});
