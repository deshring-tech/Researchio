import 'server-only';

/**
 * MODULE: server/security/rate-limit
 *
 * Purpose
 *   Fixed-window request limiting for expensive endpoints.
 *
 * Scope and honesty about it
 *   State lives in this process's memory. That is correct for the single-node
 *   deployment this app targets, and it genuinely protects against a user (or a
 *   leaked session) draining the AI quota. It does **not** hold across a
 *   multi-instance deployment or survive a restart. Moving to Redis means
 *   reimplementing `consume` alone; no caller changes.
 *
 * Public: `consume`, `RateLimitResult`
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

/** Entries are swept when the map grows past this, bounding memory. */
const SWEEP_THRESHOLD = 5_000;

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the caller may retry. Zero when allowed. */
  retryAfterSeconds: number;
  remaining: number;
}

function sweep(now: number): void {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) {
      windows.delete(key);
    }
  }
}

/**
 * Records one request against `key`.
 *
 * @param key Caller identity. Use a stable, non-guessable value such as the
 *   user id; an IP address alone is trivially shared behind NAT.
 */
export function consume(
  key: string,
  options: { limit: number; windowMs: number },
): RateLimitResult {
  const now = Date.now();

  if (windows.size > SWEEP_THRESHOLD) {
    sweep(now);
  }

  const existing = windows.get(key);

  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + options.windowMs });
    return { ok: true, retryAfterSeconds: 0, remaining: options.limit - 1 };
  }

  if (existing.count >= options.limit) {
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      remaining: 0,
    };
  }

  existing.count += 1;
  return {
    ok: true,
    retryAfterSeconds: 0,
    remaining: options.limit - existing.count,
  };
}

/** Limits for the endpoints that cost money or CPU. */
export const RATE_LIMITS = {
  /** Assistant questions: generous for real use, fatal to a scripted drain. */
  chat: { limit: 30, windowMs: 60_000 },
  /** Section drafting is markedly more expensive than a chat turn. */
  draft: { limit: 15, windowMs: 60_000 },
  /** Manual claim checks requested by a user. */
  verify: { limit: 20, windowMs: 60_000 },
  /**
   * Automatic claim checks per section, triggered by drafts, accepts and saves.
   * Caching keeps each one cheap; this caps a save loop.
   */
  verifyAutomatic: { limit: 30, windowMs: 60_000 },
} as const;
