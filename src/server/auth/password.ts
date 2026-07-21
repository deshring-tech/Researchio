import 'server-only';

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * MODULE: server/auth/password
 *
 * Purpose
 *   Hash and verify user passwords.
 *
 * Choice of algorithm
 *   Node's built-in `scrypt`. It is memory-hard, ships with the runtime, and
 *   needs no native compilation — which matters because bcrypt/argon2 bindings
 *   are a recurring source of deploy failures on Windows and Alpine images.
 *
 * Encoding
 *   `scrypt$N$r$p$<base64 salt>$<base64 hash>`
 *   Parameters are stored alongside the hash so they can be raised later
 *   without invalidating existing credentials.
 *
 * Public: `hashPassword`, `verifyPassword`
 */

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const SALT_BYTES = 16;
const KEY_BYTES = 64;

/**
 * Cost parameters. N=2^15 with r=8 needs 128 * N * r = 32 MiB per hash, which
 * is a meaningful barrier to offline cracking while staying well under a
 * typical container memory budget.
 */
const COST = { N: 32_768, r: 8, p: 1 } as const;

/** Node's default maxmem (32 MiB) is exactly at the limit, so raise the ceiling. */
const MAX_MEMORY = 96 * 1024 * 1024;

const SCHEME = 'scrypt';

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptAsync(password, salt, KEY_BYTES, { ...COST, maxmem: MAX_MEMORY });

  return [
    SCHEME,
    COST.N,
    COST.r,
    COST.p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

/**
 * Verifies a password against a stored hash.
 *
 * Returns false rather than throwing on a malformed or unknown-scheme hash, so
 * corrupt data behaves as a failed login instead of a 500.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split('$');
  if (parts.length !== 6 || parts[0] !== SCHEME) {
    return false;
  }

  const [, rawN, rawR, rawP, rawSalt, rawKey] = parts;
  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);

  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }

  let expected: Buffer;
  let actual: Buffer;
  try {
    expected = Buffer.from(rawKey, 'base64');
    actual = await scryptAsync(password, Buffer.from(rawSalt, 'base64'), expected.length, {
      N,
      r,
      p,
      maxmem: MAX_MEMORY,
    });
  } catch {
    return false;
  }

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
