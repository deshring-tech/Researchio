import { z } from 'zod';

import { CLAIM_CHECK_TARGETS } from '@/lib/domain/claims';
import { DOCUMENT_TYPES, SECTION_STATUSES } from '@/lib/domain/constants';
import { type FieldErrors, invalid } from '@/lib/errors';

/**
 * MODULE: lib/validation/schemas
 *
 * Purpose
 *   Declarative input contracts shared by Server Actions, Route Handlers and
 *   client-side form hints.
 *
 * Why one module
 *   Validation defined next to each handler drifts: the login form and the
 *   registration form disagree on password rules, and the API accepts input the
 *   UI rejects. A single set of schemas keeps the contract honest.
 *
 * Dependencies: zod, domain constants. No server-only imports, so client
 *   components can reuse the same limits for inline hints.
 */

// ---------------------------------------------------------------------------
// Shared field limits
// ---------------------------------------------------------------------------

export const LIMITS = {
  nameMax: 80,
  passwordMin: 10,
  passwordMax: 200,
  projectNameMax: 120,
  researchQuestionMax: 500,
  noteMax: 20_000,
  chatMessageMax: 4_000,
  sectionTitleMax: 160,
  sectionContentMax: 60_000,
  paperTitleMax: 300,
} as const;

const trimmed = (max: number) => z.string().trim().max(max);

const requiredText = (label: string, max: number) =>
  trimmed(max).min(1, `${label} is required.`);

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

const emailField = z
  .email('Enter a valid email address.')
  .trim()
  .max(254)
  .transform((value) => value.toLowerCase());

const passwordField = z
  .string()
  .min(LIMITS.passwordMin, `Password must be at least ${LIMITS.passwordMin} characters.`)
  .max(LIMITS.passwordMax);

export const registerSchema = z
  .object({
    name: requiredText('Name', LIMITS.nameMax),
    email: emailField,
    password: passwordField,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

export const loginSchema = z.object({
  email: emailField,
  // Deliberately not `passwordField`: tightening the rules later must not lock
  // out existing users whose password predates the new minimum.
  password: z.string().min(1, 'Password is required.'),
});

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.'),
    newPassword: passwordField,
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    message: 'Choose a password different from your current one.',
    path: ['newPassword'],
  });

export const changeProfileSchema = z.object({
  name: requiredText('Name', LIMITS.nameMax),
  email: emailField,
});

export const deleteAccountSchema = z.object({
  // Re-authentication: deletion destroys every project permanently, so an
  // unattended session must not be enough to trigger it.
  password: z.string().min(1, 'Enter your password to confirm.'),
  confirmation: z.string(),
});

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export const createProjectSchema = z.object({
  name: requiredText('Project name', LIMITS.projectNameMax),
  documentType: z.enum(DOCUMENT_TYPES),
  researchQuestion: trimmed(LIMITS.researchQuestionMax).optional(),
});

export const updateProjectSchema = z.object({
  projectId: z.uuid(),
  name: requiredText('Project name', LIMITS.projectNameMax),
  researchQuestion: trimmed(LIMITS.researchQuestionMax).optional(),
});

export const projectIdSchema = z.object({ projectId: z.uuid() });

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export const createNoteSchema = z.object({
  projectId: z.uuid(),
  content: requiredText('Note', LIMITS.noteMax),
});

export const noteIdSchema = z.object({ noteId: z.uuid() });

// ---------------------------------------------------------------------------
// Papers
// ---------------------------------------------------------------------------

export const paperIdSchema = z.object({ paperId: z.uuid() });

export const updatePaperSchema = z.object({
  paperId: z.uuid(),
  title: requiredText('Title', LIMITS.paperTitleMax),
  authors: trimmed(300).optional(),
  year: z.coerce.number().int().min(1500).max(2200).optional(),
});

// ---------------------------------------------------------------------------
// Document sections
// ---------------------------------------------------------------------------

export const createSectionSchema = z.object({
  projectId: z.uuid(),
  title: requiredText('Section title', LIMITS.sectionTitleMax),
});

export const sectionIdSchema = z.object({ sectionId: z.uuid() });

export const updateSectionSchema = z.object({
  sectionId: z.uuid(),
  userContent: trimmed(LIMITS.sectionContentMax),
});

export const setSectionStatusSchema = z.object({
  sectionId: z.uuid(),
  status: z.enum(SECTION_STATUSES),
});

export const reorderSectionSchema = z.object({
  sectionId: z.uuid(),
  direction: z.enum(['up', 'down']),
});

export const checkClaimsSchema = z.object({
  sectionId: z.uuid(),
  target: z.enum(CLAIM_CHECK_TARGETS),
});

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export const chatRequestSchema = z.object({
  projectId: z.uuid(),
  message: requiredText('Message', LIMITS.chatMessageMax),
});

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Flattens Zod issues into a `field -> message` map.
 * The first issue per field wins; showing one clear message beats stacking
 * several for the same input.
 */
function toFieldErrors(error: z.ZodError): FieldErrors {
  const fieldErrors: FieldErrors = {};

  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.') || 'form';
    fieldErrors[key] ??= issue.message;
  }

  return fieldErrors;
}

/**
 * Validates already-structured input.
 * @throws AppError('VALIDATION') carrying per-field messages.
 */
export function parseInput<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
): z.output<Schema> {
  const result = schema.safeParse(input);

  if (!result.success) {
    const fieldErrors = toFieldErrors(result.error);
    const first = Object.values(fieldErrors)[0] ?? 'Please check your input.';
    throw invalid(first, fieldErrors);
  }

  return result.data;
}

/**
 * Validates a `FormData` payload.
 *
 * Empty strings are dropped so that an untouched optional input is treated as
 * absent rather than as an empty value that fails a `min(1)` rule.
 */
export function parseFormData<Schema extends z.ZodType>(
  schema: Schema,
  formData: FormData,
): z.output<Schema> {
  const raw: Record<string, unknown> = {};

  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string' && value.length === 0) {
      continue;
    }
    raw[key] = value;
  }

  return parseInput(schema, raw);
}
