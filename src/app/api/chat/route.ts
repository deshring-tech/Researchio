import { requireUser } from '@/server/auth/session';
import { aiEnabled, streamText } from '@/server/ai/provider';
import { ACADEMIC_SYSTEM_INSTRUCTION } from '@/server/ai/prompts';
import { persistTurn, prepareTurn } from '@/server/services/chat.service';
import { RATE_LIMITS, consume } from '@/server/security/rate-limit';
import { logger } from '@/server/observability/logger';
import { chatRequestSchema, parseInput } from '@/lib/validation/schemas';
import { AppError } from '@/lib/errors';

/**
 * ROUTE: POST /api/chat
 *
 * Purpose
 *   Answer a research question against the project's indexed sources, streaming
 *   tokens as they are produced.
 *
 * Why a Route Handler rather than a Server Action
 *   Server Actions resolve to a single value. Streaming needs an open response
 *   body, which is exactly what a Route Handler provides.
 *
 * Protocol
 *   Server-Sent Events. Each line is `data: <json>` with a discriminated
 *   payload:
 *     { type: 'token',    value: string }
 *     { type: 'done',     citations: CitationRef[] }
 *     { type: 'error',    message: string }
 *
 *   Errors are delivered *inside* the stream once it has opened, because HTTP
 *   status codes are no longer available after the first byte is sent.
 */

const encoder = new TextEncoder();

function sse(payload: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

function errorResponse(error: unknown) {
  const appError =
    error instanceof AppError
      ? error
      : new AppError('INTERNAL', 'Could not answer that question.');

  if (!appError.expected) {
    logger.error('Chat request failed', error);
  }

  return Response.json(
    { error: appError.message, code: appError.code },
    { status: appError.status },
  );
}

export async function POST(request: Request): Promise<Response> {
  let prepared: Awaited<ReturnType<typeof prepareTurn>>;
  let projectId: string;
  let question: string;

  // Phase 1: everything that can still fail with a proper HTTP status.
  try {
    const user = await requireUser();

    const limit = consume(`chat:${user.id}`, RATE_LIMITS.chat);
    if (!limit.ok) {
      throw new AppError(
        'RATE_LIMITED',
        `Too many questions. Try again in ${limit.retryAfterSeconds} seconds.`,
      );
    }

    if (!aiEnabled()) {
      throw new AppError(
        'AI_UNAVAILABLE',
        'The research assistant needs GEMINI_API_KEY to be configured.',
      );
    }

    const input = parseInput(chatRequestSchema, await request.json());
    projectId = input.projectId;
    question = input.message;

    prepared = await prepareTurn(user.id, input);
  } catch (error) {
    return errorResponse(error);
  }

  // Phase 2: streaming. The response is already committed, so failures are
  // reported as an in-band error event.
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let answer = '';

      try {
        for await (const token of streamText(prepared.prompt, {
          systemInstruction: ACADEMIC_SYSTEM_INSTRUCTION,
          temperature: 0.3,
        })) {
          answer += token;
          controller.enqueue(sse({ type: 'token', value: token }));
        }

        // Only persist a turn that actually produced an answer, so a failed
        // generation does not litter the history with an empty reply.
        if (answer.trim().length > 0) {
          await persistTurn({
            projectId,
            question,
            answer,
            citations: prepared.citations,
          });
        }

        controller.enqueue(sse({ type: 'done', citations: prepared.citations }));
      } catch (error) {
        const message =
          error instanceof AppError && error.expected
            ? error.message
            : 'The answer was interrupted. Please try again.';

        if (!(error instanceof AppError && error.expected)) {
          logger.error('Chat stream failed mid-response', error, { projectId });
        }

        controller.enqueue(sse({ type: 'error', message }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Prevents buffering by reverse proxies, which would defeat streaming.
      'X-Accel-Buffering': 'no',
    },
  });
}
