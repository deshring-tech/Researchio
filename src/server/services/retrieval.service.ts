import 'server-only';

import { prisma } from '@/server/db/prisma';
import { embedOne } from '@/server/ai/provider';
import { decodeEmbedding, normalize, similarity } from '@/lib/vector';

/**
 * MODULE: server/services/retrieval
 *
 * Purpose
 *   Find the passages in a project most relevant to a query.
 *
 * Implementation
 *   Brute-force scoring in application memory. At the scale this app targets
 *   (a project holds thousands of chunks, not millions) an exhaustive scan
 *   costs a few milliseconds and avoids taking on a vector-index dependency.
 *
 *   Scoring loads only `id` and `embedding`; passage text is fetched afterwards
 *   for the winning chunks alone. Text is by far the larger column, so this
 *   keeps memory proportional to the result size rather than the corpus.
 *
 * Scale path
 *   Past roughly `SCAN_LIMIT` chunks per project, replace the scan with
 *   `sqlite-vec`, or move to PostgreSQL with `pgvector`. Only this module
 *   changes; callers are unaffected.
 *
 * Public: `retrieve`, `RetrievedChunk`
 */

/** Upper bound on chunks scanned per query, to cap worst-case latency. */
const SCAN_LIMIT = 20_000;

const DEFAULTS = {
  limit: 8,
  /**
   * Minimum cosine similarity to be considered relevant. Below roughly this
   * value, results are topically unrelated; returning them would let the
   * drafting engine cite passages that do not support the claim.
   */
  minScore: 0.35,
} as const;

export type ChunkSource =
  | { kind: 'paper'; id: string; title: string }
  | { kind: 'note'; id: string };

export interface RetrievedChunk {
  id: string;
  content: string;
  score: number;
  source: ChunkSource;
}

export interface RetrieveOptions {
  limit?: number;
  minScore?: number;
}

/**
 * Returns the passages most similar to `query`, best first.
 *
 * @returns An empty array when the project has no embedded content, so callers
 *   can distinguish "nothing indexed yet" from "nothing relevant".
 */
export async function retrieve(
  projectId: string,
  query: string,
  options: RetrieveOptions = {},
): Promise<RetrievedChunk[]> {
  const { limit, minScore } = { ...DEFAULTS, ...options };

  const candidates = await prisma.chunk.findMany({
    where: { projectId, embedding: { not: null } },
    select: { id: true, embedding: true },
    take: SCAN_LIMIT,
  });

  if (candidates.length === 0) {
    return [];
  }

  const queryVector = Float32Array.from(normalize(await embedOne(query)));

  const scored: Array<{ id: string; score: number }> = [];
  for (const candidate of candidates) {
    if (!candidate.embedding) {
      continue;
    }

    const score = similarity(queryVector, decodeEmbedding(candidate.embedding));
    if (score >= minScore) {
      scored.push({ id: candidate.id, score });
    }
  }

  if (scored.length === 0) {
    return [];
  }

  scored.sort((a, b) => b.score - a.score);
  const winners = scored.slice(0, limit);

  const rows = await prisma.chunk.findMany({
    where: { id: { in: winners.map((winner) => winner.id) } },
    select: {
      id: true,
      content: true,
      noteId: true,
      paper: { select: { id: true, title: true } },
    },
  });

  // `findMany` does not preserve the order of an `in` filter, so re-apply the
  // ranking rather than returning results in arbitrary database order.
  const byId = new Map(rows.map((row) => [row.id, row]));

  return winners.flatMap<RetrievedChunk>((winner) => {
    const row = byId.get(winner.id);
    if (!row) {
      return [];
    }

    const source: ChunkSource | null = row.paper
      ? { kind: 'paper', id: row.paper.id, title: row.paper.title }
      : row.noteId
        ? { kind: 'note', id: row.noteId }
        : null;

    // A chunk whose parent has been deleted is not citable.
    return source ? [{ id: row.id, content: row.content, score: winner.score, source }] : [];
  });
}
