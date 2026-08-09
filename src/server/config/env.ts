import 'server-only';

import path from 'node:path';
import { z } from 'zod';

/**
 * MODULE: server/config/env
 *
 * Purpose
 *   Parse and validate process environment once, at first import, and expose it
 *   as a typed frozen object.
 *
 * Responsibilities
 *   - Fail fast and loudly on malformed configuration rather than surfacing it
 *     as a confusing runtime error deep in a request.
 *   - Apply defaults in exactly one place.
 *   - Resolve path-like settings to absolute paths.
 *
 * Public: `env`, `isAiConfigured`
 */

const booleanish = z
  .string()
  .optional()
  .transform((value) => value === '1' || value?.toLowerCase() === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  GEMINI_API_KEY: z.string().optional().transform((v) => v?.trim() || ''),
  // Both defaults are deliberate.
  //
  // Version-pinned names get retired, and some remain listed by the API while
  // being closed to new accounts — `gemini-2.5-flash` returns "no longer
  // available to new users" despite appearing in ListModels. The `-latest`
  // alias tracks the current model and does not rot.
  //
  // `text-embedding-004` was retired outright and 404s on embedContent.
  //
  // A dead name fails only when called, so uploads appear to succeed while
  // every document is left unindexed. Run `npm run ai:check` after changing
  // either value.
  GEMINI_TEXT_MODEL: z.string().min(1).default('gemini-flash-latest'),
  GEMINI_EMBEDDING_MODEL: z.string().min(1).default('gemini-embedding-001'),

  UPLOAD_DIR: z.string().min(1).default('storage/uploads'),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().max(200).default(25),

  SECURE_COOKIES: booleanish,
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

const raw = parsed.data;
const projectRoot = process.env.PROJECT_ROOT?.trim() || process.cwd();

export const env = Object.freeze({
  nodeEnv: raw.NODE_ENV,
  isProduction: raw.NODE_ENV === 'production',

  ai: Object.freeze({
    apiKey: raw.GEMINI_API_KEY,
    textModel: raw.GEMINI_TEXT_MODEL,
    embeddingModel: raw.GEMINI_EMBEDDING_MODEL,
  }),

  uploads: Object.freeze({
    directory: path.isAbsolute(raw.UPLOAD_DIR)
      ? raw.UPLOAD_DIR
      : path.resolve(projectRoot, raw.UPLOAD_DIR),
    maxBytes: raw.MAX_UPLOAD_MB * 1024 * 1024,
    maxMegabytes: raw.MAX_UPLOAD_MB,
  }),

  // Secure cookies are implied in production even if the flag is unset, so a
  // forgotten env var cannot downgrade cookie security on a live deployment.
  secureCookies: raw.SECURE_COOKIES || raw.NODE_ENV === 'production',
});

/** True when a real AI provider key is present. */
export function isAiConfigured(): boolean {
  return env.ai.apiKey.length > 0;
}
