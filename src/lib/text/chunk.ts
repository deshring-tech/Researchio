/**
 * MODULE: lib/text/chunk
 *
 * Purpose
 *   Split long source text into overlapping passages suitable for embedding
 *   and retrieval.
 *
 * Why chunking matters
 *   A single embedding for a 30-page paper averages away everything specific
 *   about it, so retrieval returns the same documents for every query. Passage
 *   level embeddings are what make a citation point at an actual claim.
 *
 * Strategy
 *   Prefer paragraph boundaries, fall back to sentence boundaries, and only
 *   hard-split when a single sentence exceeds the limit. Consecutive chunks
 *   overlap so a claim spanning a boundary is still retrievable in full.
 *
 * Dependencies: none.
 */

export interface ChunkOptions {
  /** Target maximum characters per chunk. */
  maxChars?: number;
  /** Characters of trailing context repeated at the start of the next chunk. */
  overlapChars?: number;
  /** Chunks shorter than this are dropped as noise (page numbers, headers). */
  minChars?: number;
}

const DEFAULTS = {
  maxChars: 1_200,
  overlapChars: 180,
  minChars: 60,
} as const satisfies Required<ChunkOptions>;

/**
 * Collapses the whitespace damage typical of PDF text extraction: hyphenated
 * line breaks, single newlines mid-sentence, and runs of blank lines.
 */
export function normalizeExtractedText(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    // Re-join words split across a line break by hyphenation.
    .replace(/(\w)-\n(\w)/g, '$1$2')
    // A single newline inside a sentence is a wrap artifact, not a paragraph.
    .replace(/([^\n])\n([^\n])/g, '$1 $2')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitSentences(paragraph: string): string[] {
  // Split after sentence-ending punctuation followed by whitespace.
  const parts = paragraph.split(/(?<=[.!?])\s+/);
  return parts.filter((part) => part.trim().length > 0);
}

/** Hard-splits a fragment that has no usable internal boundary. */
function splitOversized(fragment: string, maxChars: number): string[] {
  const pieces: string[] = [];
  for (let start = 0; start < fragment.length; start += maxChars) {
    pieces.push(fragment.slice(start, start + maxChars));
  }
  return pieces;
}

/**
 * Returns the trailing `overlapChars` of a chunk, trimmed to a word boundary so
 * the carried context does not begin mid-word.
 */
function tailOverlap(text: string, overlapChars: number): string {
  if (overlapChars <= 0 || text.length <= overlapChars) {
    return '';
  }

  const tail = text.slice(-overlapChars);
  const firstSpace = tail.indexOf(' ');
  return firstSpace === -1 ? tail : tail.slice(firstSpace + 1);
}

/**
 * Splits text into retrieval-sized passages.
 *
 * @returns Passages in reading order. Empty when the input has no usable text.
 */
export function chunkText(input: string, options: ChunkOptions = {}): string[] {
  const { maxChars, overlapChars, minChars } = { ...DEFAULTS, ...options };

  const normalized = normalizeExtractedText(input);
  if (normalized.length === 0) {
    return [];
  }

  // Break paragraphs down until every fragment fits within maxChars.
  const fragments: string[] = [];
  for (const paragraph of normalized.split(/\n{2,}/)) {
    const trimmed = paragraph.trim();
    if (trimmed.length === 0) {
      continue;
    }

    if (trimmed.length <= maxChars) {
      fragments.push(trimmed);
      continue;
    }

    for (const sentence of splitSentences(trimmed)) {
      if (sentence.length <= maxChars) {
        fragments.push(sentence);
      } else {
        fragments.push(...splitOversized(sentence, maxChars));
      }
    }
  }

  // Greedily pack fragments into chunks, carrying overlap between them.
  const chunks: string[] = [];
  let current = '';

  const flush = () => {
    const candidate = current.trim();
    if (candidate.length > 0) {
      chunks.push(candidate);
    }
    current = '';
  };

  for (const fragment of fragments) {
    if (current.length === 0) {
      current = fragment;
      continue;
    }

    if (current.length + fragment.length + 1 <= maxChars) {
      current += ` ${fragment}`;
      continue;
    }

    // Clamp the carried overlap to whatever room the incoming fragment leaves.
    // Without this, a full-size fragment plus a full-size overlap produces a
    // chunk larger than `maxChars` — at the defaults, 1380 characters against a
    // 1200 limit. Oversized passages risk silent truncation by the embedding
    // API, which would drop the tail of the passage from the index while
    // appearing to succeed.
    const room = maxChars - fragment.length - 1;
    const overlap = room > 0 ? tailOverlap(current, Math.min(overlapChars, room)) : '';

    flush();
    current = overlap.length > 0 ? `${overlap} ${fragment}` : fragment;
  }

  flush();

  // Keep a short chunk only when it is the entire document, so that a one-line
  // note is still retrievable while page furniture is discarded.
  if (chunks.length === 1) {
    return chunks;
  }

  return chunks.filter((chunk) => chunk.length >= minChars);
}
