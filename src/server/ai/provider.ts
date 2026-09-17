import 'server-only';

import { GoogleGenAI } from '@google/genai';

import { env, isAiConfigured } from '@/server/config/env';
import { AppError } from '@/lib/errors';

/**
 * MODULE: server/ai/provider
 *
 * Purpose
 *   The single boundary between this application and the AI vendor.
 *
 * Responsibilities
 *   - Lazily construct and reuse the SDK client.
 *   - Enforce timeouts and retry genuinely transient failures.
 *   - Batch embedding requests.
 *   - Fail explicitly when no API key is configured.
 *
 * On the absence of a key
 *   The previous implementation returned invented text and a vector of constant
 *   0.1 values when unconfigured. That produced a system which looked like it
 *   worked while silently corrupting the retrieval index and presenting
 *   fabricated research to the user. Every entry point here now raises
 *   `AI_UNAVAILABLE`, and callers surface that state in the UI.
 *
 * Future extension points
 *   Swapping vendors, or routing different tasks to different models, is a
 *   change confined to this file.
 */

const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Retry budget for transient failures. Sized for provider demand spikes, which
 * return 503 for several seconds at a time: three attempts starting at 500ms
 * gave up after about two seconds in live testing. Four attempts from one
 * second waits roughly 1s, 2s and 4s — acceptable behind a spinner, and far
 * better than failing a draft the user explicitly asked for.
 */
const MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 1_000;

/** Embedding requests are batched; the API rejects oversized batches. */
const EMBED_BATCH_SIZE = 64;

/**
 * Dimensions requested per embedding.
 *
 * `gemini-embedding-001` returns 3072 by default. Truncating to 768 cuts stored
 * size and scan cost fourfold — retrieval here compares a few thousand chunks
 * within one project, where the extra dimensions buy no measurable accuracy.
 *
 * Reduced-dimension output is not unit-length, so it must be normalized before
 * use; `encodeEmbedding` does that for stored vectors and `retrieve` for the
 * query. Changing this value invalidates existing embeddings, since vectors of
 * differing length score zero against each other.
 */
const EMBED_DIMENSIONS = 768;

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!isAiConfigured()) {
    throw new AppError(
      'AI_UNAVAILABLE',
      'AI features are not configured. Add GEMINI_API_KEY to your environment and restart the server.',
    );
  }

  client ??= new GoogleGenAI({ apiKey: env.ai.apiKey });
  return client;
}

/** True when AI-backed features can run. Lets callers degrade before trying. */
export function aiEnabled(): boolean {
  return isAiConfigured();
}

// ---------------------------------------------------------------------------
// Reliability helpers
// ---------------------------------------------------------------------------

function withTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new AppError('AI_UNAVAILABLE', `The AI provider timed out during ${label}.`));
    }, REQUEST_TIMEOUT_MS);

    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Identifies failures worth retrying: rate limits, timeouts and 5xx responses.
 * A malformed request or invalid key will fail identically every time, so
 * retrying it only delays the error the user needs to see.
 */
function isTransient(error: unknown): boolean {
  if (error instanceof AppError) {
    return error.code === 'AI_UNAVAILABLE';
  }

  const message = error instanceof Error ? error.message : String(error);
  return /\b(429|500|502|503|504)\b|rate.?limit|timeout|ECONNRESET|ETIMEDOUT|fetch failed/i.test(
    message,
  );
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetry<T>(label: string, operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await withTimeout(operation(), label);
    } catch (error) {
      lastError = error;
      if (!isTransient(error) || attempt === MAX_ATTEMPTS) {
        break;
      }
      // Exponential backoff with jitter, to avoid synchronized retries.
      await delay(BASE_BACKOFF_MS * 2 ** (attempt - 1) * (0.5 + Math.random()));
    }
  }

  throw normalizeError(lastError, label);
}

function normalizeError(error: unknown, label: string): AppError {
  if (error instanceof AppError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);

  if (/api.?key|unauthenticated|permission/i.test(message)) {
    return new AppError('AI_UNAVAILABLE', 'The configured AI API key was rejected.', {
      cause: error,
    });
  }

  // Capacity errors are temporary and not the user's doing; saying so tells
  // them that simply trying again later is the right response.
  if (/\b(429|503)\b|high demand|overloaded|resource.?exhausted|rate.?limit/i.test(message)) {
    return new AppError(
      'AI_UNAVAILABLE',
      'The AI provider is overloaded right now. Try again in a minute.',
      { cause: error },
    );
  }

  return new AppError('AI_UNAVAILABLE', `The AI provider failed during ${label}.`, {
    cause: error,
  });
}

// ---------------------------------------------------------------------------
// Text generation
// ---------------------------------------------------------------------------

export interface GenerateOptions {
  /** Lower values produce more deterministic, less florid academic prose. */
  temperature?: number;
  maxOutputTokens?: number;
  systemInstruction?: string;
}

export async function generateText(
  prompt: string,
  options: GenerateOptions = {},
): Promise<string> {
  const response = await withRetry('text generation', () =>
    getClient().models.generateContent({
      model: env.ai.textModel,
      contents: prompt,
      config: {
        temperature: options.temperature ?? 0.3,
        maxOutputTokens: options.maxOutputTokens,
        systemInstruction: options.systemInstruction,
      },
    }),
  );

  const text = response.text?.trim();
  if (!text) {
    throw new AppError('AI_UNAVAILABLE', 'The AI provider returned an empty response.');
  }

  return text;
}

/**
 * Generates a JSON object conforming to `jsonSchema`, validated against `schema`.
 *
 * Two layers on purpose: `responseJsonSchema` constrains the model's decoding so
 * it rarely produces malformed output, and the Zod parse guarantees the value
 * actually matches the type callers rely on. Free-text parsing of an LLM
 * response is the usual source of intermittent production failures here.
 */
export async function generateJson<T>(
  prompt: string,
  jsonSchema: Record<string, unknown>,
  schema: { safeParse: (value: unknown) => { success: boolean; data?: T } },
  options: GenerateOptions = {},
): Promise<T> {
  const response = await withRetry('structured generation', () =>
    getClient().models.generateContent({
      model: env.ai.textModel,
      contents: prompt,
      config: {
        temperature: options.temperature ?? 0.2,
        maxOutputTokens: options.maxOutputTokens,
        systemInstruction: options.systemInstruction,
        responseMimeType: 'application/json',
        responseJsonSchema: jsonSchema,
      },
    }),
  );

  const text = response.text?.trim();
  if (!text) {
    throw new AppError('AI_UNAVAILABLE', 'The AI provider returned an empty response.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new AppError('AI_UNAVAILABLE', 'The AI provider returned malformed JSON.', {
      cause: error,
    });
  }

  const result = schema.safeParse(parsed);
  if (!result.success || result.data === undefined) {
    throw new AppError(
      'AI_UNAVAILABLE',
      'The AI response did not match the expected structure.',
    );
  }

  return result.data;
}

/**
 * Streams generated text as it arrives.
 *
 * Not retried: once the first token has been sent to the client, restarting
 * would duplicate output. Transient failures surface as a truncated stream.
 */
export async function* streamText(
  prompt: string,
  options: GenerateOptions = {},
): AsyncGenerator<string> {
  const stream = await withTimeout(
    getClient().models.generateContentStream({
      model: env.ai.textModel,
      contents: prompt,
      config: {
        temperature: options.temperature ?? 0.3,
        maxOutputTokens: options.maxOutputTokens,
        systemInstruction: options.systemInstruction,
      },
    }),
    'streaming',
  );

  for await (const chunk of stream) {
    const text = chunk.text;
    if (text) {
      yield text;
    }
  }
}

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

/**
 * Embeds texts in batches, preserving input order.
 *
 * @throws AppError when the provider returns fewer vectors than inputs, which
 *   would otherwise misalign every embedding against the wrong chunk.
 */
export async function embedTexts(texts: readonly string[]): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  const vectors: number[][] = [];

  for (let start = 0; start < texts.length; start += EMBED_BATCH_SIZE) {
    const batch = texts.slice(start, start + EMBED_BATCH_SIZE);

    const response = await withRetry('embedding', () =>
      getClient().models.embedContent({
        model: env.ai.embeddingModel,
        contents: [...batch],
        config: { outputDimensionality: EMBED_DIMENSIONS },
      }),
    );

    const embeddings = response.embeddings ?? [];
    if (embeddings.length !== batch.length) {
      throw new AppError(
        'AI_UNAVAILABLE',
        `Embedding provider returned ${embeddings.length} vectors for ${batch.length} inputs.`,
      );
    }

    for (const embedding of embeddings) {
      const values = embedding.values;
      if (!values || values.length === 0) {
        throw new AppError('AI_UNAVAILABLE', 'Embedding provider returned an empty vector.');
      }
      vectors.push(values);
    }
  }

  return vectors;
}

/** Convenience wrapper for embedding a single string, such as a search query. */
export async function embedOne(text: string): Promise<number[]> {
  const [vector] = await embedTexts([text]);
  return vector;
}
