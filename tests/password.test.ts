import { describe, expect, it } from 'vitest';

import { hashPassword, verifyPassword } from '@/server/auth/password';

describe('hashPassword', () => {
  it('produces a hash carrying its own cost parameters', () => {
    // Storing N, r and p alongside the digest is what allows the cost to be
    // raised later without invalidating existing credentials.
    return hashPassword('correct-horse-battery').then((hash) => {
      const parts = hash.split('$');
      expect(parts).toHaveLength(6);
      expect(parts[0]).toBe('scrypt');
      expect(Number(parts[1])).toBeGreaterThanOrEqual(16_384);
    });
  });

  it('salts, so identical passwords hash differently', async () => {
    const [first, second] = await Promise.all([
      hashPassword('same-password-value'),
      hashPassword('same-password-value'),
    ]);

    expect(first).not.toBe(second);
  });

  it('never embeds the plaintext', async () => {
    const hash = await hashPassword('unmistakable-plaintext');
    expect(hash).not.toContain('unmistakable-plaintext');
  });
});

describe('verifyPassword', () => {
  it('accepts the correct password', async () => {
    const hash = await hashPassword('correct-horse-battery');
    expect(await verifyPassword('correct-horse-battery', hash)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('correct-horse-battery');
    expect(await verifyPassword('wrong-password-here', hash)).toBe(false);
  });

  it('is case sensitive', async () => {
    const hash = await hashPassword('CaseSensitiveValue');
    expect(await verifyPassword('casesensitivevalue', hash)).toBe(false);
  });

  it('handles unicode and long passwords', async () => {
    const password = '🔐 пароль 密码 '.repeat(10);
    const hash = await hashPassword(password);

    expect(await verifyPassword(password, hash)).toBe(true);
    expect(await verifyPassword(`${password}x`, hash)).toBe(false);
  });

  it.each([
    ['garbage', 'not-a-hash'],
    ['wrong scheme', 'bcrypt$1$2$3$c2FsdA==$aGFzaA=='],
    ['too few fields', 'scrypt$16384$8$c2FsdA=='],
    ['non-numeric cost', 'scrypt$abc$8$1$c2FsdA==$aGFzaA=='],
    ['empty string', ''],
  ])('returns false for a malformed hash (%s) rather than throwing', async (_label, stored) => {
    // Corrupt stored data must behave as a failed login, never as a 500.
    await expect(verifyPassword('any-password', stored)).resolves.toBe(false);
  });
});
