import 'server-only';

import { prisma } from '@/server/db/prisma';
import { chatPrompt, sourceLabel } from '@/server/ai/prompts';
import { retrieve, type RetrievedChunk } from '@/server/services/retrieval.service';
import { assertProjectAccess } from '@/server/services/project.service';
import { notFound } from '@/lib/errors';

/**
 * MODULE: server/services/chat
 *
 * Purpose
 *   Back the research assistant: retrieve project evidence, compose the prompt,
 *   and persist the conversation.
 *
 * Separation of concerns
 *   This module does not stream. It prepares everything needed for a turn and
 *   persists the result, leaving transport to the Route Handler. That keeps the
 *   retrieval and persistence logic testable without an HTTP context.
 *
 * Public: `listMessages`, `prepareTurn`, `persistTurn`
 */

/** Conversation turns included as context. Older turns are dropped. */
const HISTORY_TURNS = 6;

/** Passages retrieved per question. */
const SOURCE_LIMIT = 8;

/** A citation as surfaced to the client. */
export interface CitationRef {
  label: string;
  kind: 'paper' | 'note';
  id: string;
  title: string;
}

export interface PreparedTurn {
  prompt: string;
  sources: RetrievedChunk[];
  citations: CitationRef[];
}

/**
 * Returns the most recent conversation turns, oldest first.
 *
 * The two-step ordering matters: selecting `asc` with a `take` would return the
 * first N messages ever sent, so a long-running conversation would freeze on
 * its opening exchanges and the user would never see what they just asked.
 * Take the newest N by `desc`, then restore reading order.
 */
export async function listMessages(projectId: string, limit = 50) {
  const messages = await prisma.chatMessage.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return messages.reverse().map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    citations: parseCitations(message.citations),
    createdAt: message.createdAt,
  }));
}

function parseCitations(raw: string | null): CitationRef[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CitationRef[]) : [];
  } catch {
    // Malformed stored citations degrade to none rather than breaking the view.
    return [];
  }
}

function toCitations(sources: readonly RetrievedChunk[]): CitationRef[] {
  return sources.map((source, index) => ({
    label: sourceLabel(index),
    kind: source.source.kind,
    id: source.source.id,
    title: source.source.kind === 'paper' ? source.source.title : 'Your note',
  }));
}

/**
 * Verifies access, gathers evidence and builds the prompt for one question.
 *
 * @throws AppError NOT_FOUND when the project is missing or not the user's.
 */
export async function prepareTurn(
  userId: string,
  input: { projectId: string; message: string },
): Promise<PreparedTurn> {
  await assertProjectAccess(input.projectId, userId);

  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { name: true, researchQuestion: true },
  });

  if (!project) {
    throw notFound('Project');
  }

  const [sources, recent] = await Promise.all([
    retrieve(input.projectId, input.message, { limit: SOURCE_LIMIT }),
    prisma.chatMessage.findMany({
      where: { projectId: input.projectId },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_TURNS,
      select: { role: true, content: true },
    }),
  ]);

  const prompt = chatPrompt({
    projectName: project.name,
    researchQuestion: project.researchQuestion,
    sources,
    // `findMany` returned newest-first for the limit; restore chronology.
    history: [...recent].reverse(),
    question: input.message,
  });

  return { prompt, sources, citations: toCitations(sources) };
}

/**
 * Stores a completed exchange.
 *
 * Both messages are written in one transaction so a failure cannot leave a
 * question in the history with no answer beneath it.
 */
export async function persistTurn(params: {
  projectId: string;
  question: string;
  answer: string;
  citations: readonly CitationRef[];
}): Promise<void> {
  const citations = params.citations.length > 0 ? JSON.stringify(params.citations) : null;

  await prisma.$transaction([
    prisma.chatMessage.create({
      data: { projectId: params.projectId, role: 'user', content: params.question },
    }),
    prisma.chatMessage.create({
      data: {
        projectId: params.projectId,
        role: 'assistant',
        content: params.answer,
        citations,
      },
    }),
  ]);
}
