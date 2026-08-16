import { describe, expect, it } from 'vitest';

import {
  changePasswordSchema,
  createNoteSchema,
  loginSchema,
  parseFormData,
  parseInput,
  registerSchema,
} from '@/lib/validation/schemas';
import { AppError } from '@/lib/errors';

const UUID = '00000000-0000-4000-8000-000000000000';

function formDataOf(entries: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    form.set(key, value);
  }
  return form;
}

describe('registerSchema', () => {
  const valid = {
    name: 'Ada Lovelace',
    email: 'Ada@Example.COM',
    password: 'a-long-enough-password',
    confirmPassword: 'a-long-enough-password',
  };

  it('lowercases the email so accounts cannot be duplicated by case', () => {
    expect(parseInput(registerSchema, valid).email).toBe('ada@example.com');
  });

  it('trims surrounding whitespace from the name', () => {
    expect(parseInput(registerSchema, { ...valid, name: '  Ada  ' }).name).toBe('Ada');
  });

  it('rejects mismatched passwords, attributing the error to the confirm field', () => {
    try {
      parseInput(registerSchema, { ...valid, confirmPassword: 'different-password' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).fieldErrors?.confirmPassword).toMatch(/do not match/i);
    }
  });

  it('rejects a short password', () => {
    expect(() =>
      parseInput(registerSchema, { ...valid, password: 'short', confirmPassword: 'short' }),
    ).toThrow(AppError);
  });

  it('rejects a malformed email', () => {
    expect(() => parseInput(registerSchema, { ...valid, email: 'not-an-email' })).toThrow(
      AppError,
    );
  });

  it('rejects an empty name', () => {
    expect(() => parseInput(registerSchema, { ...valid, name: '   ' })).toThrow(AppError);
  });
});

describe('loginSchema', () => {
  it('does not enforce the password minimum', () => {
    // Raising the minimum later must not lock out existing accounts.
    expect(() => parseInput(loginSchema, { email: 'a@b.com', password: 'x' })).not.toThrow();
  });

  it('still requires a password to be present', () => {
    expect(() => parseInput(loginSchema, { email: 'a@b.com', password: '' })).toThrow(AppError);
  });
});

describe('changePasswordSchema', () => {
  const valid = {
    currentPassword: 'old-password-value',
    newPassword: 'brand-new-password',
    confirmPassword: 'brand-new-password',
  };

  it('accepts a well-formed change', () => {
    expect(() => parseInput(changePasswordSchema, valid)).not.toThrow();
  });

  it('rejects reusing the current password', () => {
    expect(() =>
      parseInput(changePasswordSchema, {
        currentPassword: 'brand-new-password',
        newPassword: 'brand-new-password',
        confirmPassword: 'brand-new-password',
      }),
    ).toThrow(AppError);
  });

  it('rejects a mismatched confirmation', () => {
    expect(() =>
      parseInput(changePasswordSchema, { ...valid, confirmPassword: 'something-else' }),
    ).toThrow(AppError);
  });
});

describe('parseFormData', () => {
  it('reads values out of a FormData payload', () => {
    const parsed = parseFormData(
      createNoteSchema,
      formDataOf({ projectId: UUID, content: 'A note.' }),
    );

    expect(parsed).toEqual({ projectId: UUID, content: 'A note.' });
  });

  it('treats an empty optional field as absent', () => {
    // An untouched optional input submits "", which must not be validated as a
    // supplied empty value.
    const parsed = parseFormData(
      registerSchema,
      formDataOf({
        name: 'Ada',
        email: 'ada@example.com',
        password: 'a-long-enough-password',
        confirmPassword: 'a-long-enough-password',
      }),
    );

    expect(parsed.name).toBe('Ada');
  });

  it('rejects a non-uuid project id', () => {
    expect(() =>
      parseFormData(createNoteSchema, formDataOf({ projectId: 'nope', content: 'x' })),
    ).toThrow(AppError);
  });

  it('produces a VALIDATION error carrying per-field messages', () => {
    try {
      parseFormData(createNoteSchema, formDataOf({ projectId: 'nope', content: '' }));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as AppError).code).toBe('VALIDATION');
      expect(Object.keys((error as AppError).fieldErrors ?? {})).toContain('projectId');
    }
  });
});
