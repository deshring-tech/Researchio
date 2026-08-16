import 'server-only';

/**
 * MODULE: server/observability/logger
 *
 * Purpose
 *   Structured application logging.
 *
 * Why not console.error directly
 *   Scattered `console.error` calls produce output that cannot be filtered,
 *   searched or shipped anywhere. In production every line here is a single
 *   JSON object, which any log aggregator (Loki, CloudWatch, Datadog) can
 *   index without a custom parser. In development the same records print as
 *   readable text.
 *
 * Redaction
 *   Fields whose names suggest credentials are replaced before serialization,
 *   so an incidental `{ password }` in a context object cannot reach disk.
 *
 * Public: `logger`, `withRequestId`
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** Context values attached to a log record. */
export type LogContext = Record<string, unknown>;

const isProduction = process.env.NODE_ENV === 'production';

/** Below this level, records are dropped. */
const minimumLevel: LogLevel = (() => {
  const configured = process.env.LOG_LEVEL?.toLowerCase();
  if (configured && configured in LEVEL_ORDER) {
    return configured as LogLevel;
  }
  return isProduction ? 'info' : 'debug';
})();

/** Case-insensitive substrings that mark a value as secret. */
const SECRET_KEY_PATTERN = /pass|secret|token|api[-_]?key|authorization|cookie|hash/i;

function redact(context: LogContext): LogContext {
  const safe: LogContext = {};

  for (const [key, value] of Object.entries(context)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      safe[key] = '[redacted]';
    } else if (value instanceof Error) {
      safe[key] = serializeError(value);
    } else {
      safe[key] = value;
    }
  }

  return safe;
}

/**
 * Converts an Error into a serializable shape.
 *
 * `cause` is followed one level deep, which is where the underlying provider
 * or driver error usually lives — losing it would hide the actual failure.
 */
function serializeError(error: unknown): unknown {
  if (!(error instanceof Error)) {
    return error;
  }

  const serialized: Record<string, unknown> = {
    name: error.name,
    message: error.message,
  };

  // Stacks are noise in development, where the console prints them anyway.
  if (isProduction && error.stack) {
    serialized.stack = error.stack;
  }

  if ('code' in error) {
    serialized.code = (error as { code: unknown }).code;
  }

  if (error.cause) {
    serialized.cause =
      error.cause instanceof Error
        ? { name: error.cause.name, message: error.cause.message }
        : String(error.cause).slice(0, 500);
  }

  return serialized;
}

function emit(level: LogLevel, message: string, context: LogContext = {}): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minimumLevel]) {
    return;
  }

  const safe = redact(context);
  const write = level === 'error' || level === 'warn' ? console.error : console.log;

  if (isProduction) {
    write(
      JSON.stringify({
        level,
        message,
        time: new Date().toISOString(),
        ...safe,
      }),
    );
    return;
  }

  const suffix = Object.keys(safe).length > 0 ? ` ${JSON.stringify(safe)}` : '';
  write(`[${level}] ${message}${suffix}`);
}

export const logger = {
  debug: (message: string, context?: LogContext) => emit('debug', message, context),
  info: (message: string, context?: LogContext) => emit('info', message, context),
  warn: (message: string, context?: LogContext) => emit('warn', message, context),

  /**
   * Records a failure. Pass the caught value as `error`; it is serialized
   * including one level of `cause`.
   */
  error: (message: string, error?: unknown, context?: LogContext) =>
    emit('error', message, { ...context, error: serializeError(error) }),
};

/**
 * Returns a logger that stamps every record with the same identifier.
 *
 * Used to correlate the lines emitted while handling one request or one
 * background ingestion job.
 */
export function withContext(base: LogContext) {
  return {
    debug: (message: string, context?: LogContext) =>
      emit('debug', message, { ...base, ...context }),
    info: (message: string, context?: LogContext) =>
      emit('info', message, { ...base, ...context }),
    warn: (message: string, context?: LogContext) =>
      emit('warn', message, { ...base, ...context }),
    error: (message: string, error?: unknown, context?: LogContext) =>
      emit('error', message, { ...base, ...context, error: serializeError(error) }),
  };
}
