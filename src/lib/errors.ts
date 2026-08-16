/**
 * MODULE: lib/errors
 *
 * Purpose
 *   A single typed error vocabulary shared by services, Server Actions and
 *   Route Handlers, plus the result envelope Server Actions return to clients.
 *
 * Why a result envelope rather than thrown errors
 *   A thrown error inside a Server Action reaches the client as an opaque
 *   "An error occurred in the Server Components render" in production. Returning
 *   an explicit discriminated union lets the UI render an accurate message and
 *   per-field validation feedback, while genuinely unexpected failures still
 *   throw and hit the error boundary.
 *
 * Dependencies: none. Safe to import from client components.
 */

export const ERROR_CODES = [
  'VALIDATION',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'AI_UNAVAILABLE',
  'UNSUPPORTED_MEDIA',
  'PAYLOAD_TOO_LARGE',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  AI_UNAVAILABLE: 503,
  UNSUPPORTED_MEDIA: 415,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL: 500,
};

/** Field name -> message, for form-level validation feedback. */
export type FieldErrors = Record<string, string>;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fieldErrors?: FieldErrors;
  /** False for genuinely unexpected failures, which must be logged in full. */
  readonly expected: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    options: { cause?: unknown; fieldErrors?: FieldErrors; expected?: boolean } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = HTTP_STATUS[code];
    this.fieldErrors = options.fieldErrors;
    this.expected = options.expected ?? code !== 'INTERNAL';
  }
}

// Constructors for the codes used often enough that the shorthand earns itself.
export const notFound = (what: string) => new AppError('NOT_FOUND', `${what} not found.`);
export const unauthorized = () =>
  new AppError('UNAUTHORIZED', 'You need to sign in to do that.');
export const forbidden = () =>
  new AppError('FORBIDDEN', 'You do not have access to this resource.');
export const invalid = (message: string, fieldErrors?: FieldErrors) =>
  new AppError('VALIDATION', message, { fieldErrors });

// ---------------------------------------------------------------------------
// Action results
// ---------------------------------------------------------------------------

export type ActionFailure = {
  ok: false;
  code: ErrorCode;
  message: string;
  fieldErrors?: FieldErrors;
};

export type ActionSuccess<T> = { ok: true; data: T };

export type ActionResult<T = undefined> = ActionSuccess<T> | ActionFailure;

export function success(): ActionResult<undefined>;
export function success<T>(data: T): ActionResult<T>;
export function success<T>(data?: T): ActionResult<T | undefined> {
  return { ok: true, data };
}

export function failure(
  code: ErrorCode,
  message: string,
  fieldErrors?: FieldErrors,
): ActionFailure {
  return { ok: false, code, message, fieldErrors };
}

export const GENERIC_ERROR_MESSAGE = 'Something went wrong. Please try again.';

/**
 * True when an error is safe to show the user verbatim.
 *
 * Anything else must be reported generically, since its message may carry
 * database or provider internals.
 */
export function isExpected(error: unknown): error is AppError {
  return error instanceof AppError && error.expected;
}

/**
 * Converts any thrown value into a client-safe failure.
 *
 * Deliberately does no logging: this module is imported by Client Components,
 * so it cannot depend on the server-only logger. Callers on the server log
 * unexpected errors themselves — see `server/actions/runner`.
 */
export function toActionFailure(error: unknown): ActionFailure {
  if (isExpected(error)) {
    return failure(error.code, error.message, error.fieldErrors);
  }

  return failure('INTERNAL', GENERIC_ERROR_MESSAGE);
}
