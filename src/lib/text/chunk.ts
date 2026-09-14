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
 * Offsets
 *   Every chunk is an exact slice of the normalized text and carries its
 *   `[start, end)` offsets into it. That is what lets a passage be mapped back
 *   to the PDF page it came from. Rebuilding passages by joining fragments
 *   with spaces — the previous approach — produced text that could no longer
 *   be located in its own source.
 *
 * Public: `normalizeExtractedText`, `chunkSpans`, `chunkText`, `TextSpan`
 * Dependencies: none.
 */

export interface ChunkOptions {
  /** Maximum characters per chunk. Never exceeded. */
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

/** A passage together with its position in the normalized text. */
export interface TextSpan {
  content: string;
  /** Inclusive start offset. */
  start: number;
  /** Exclusive end offset. */
  end: number;
}

interface Range {
  start: number;
  end: number;
}

/**
 * Collapses the whitespace damage typical of PDF text extraction: hyphenated
 * line breaks, single newlines mid-sentence, and runs of blank lines.
 *
 * The output contains only single spaces and `\n\n` paragraph breaks, and the
 * function is idempotent. Idempotence matters: offsets computed against
 * normalized text stay valid if that text is normalized again.
 */
export function normalizeExtractedText(input: string): string {
  return (
    input
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+/g, ' ')
      // Strip spaces around newlines first, so a whitespace-only line still
      // reads as a blank line (a paragraph break) rather than as a wrap.
      .replace(/ ?\n ?/g, '\n')
      // Re-join words split across a line break by hyphenation.
      .replace(/(?<=\w)-\n(?=\w)/g, '')
      // A single newline inside a sentence is a wrap artifact, not a paragraph.
      // Lookarounds rather than captures: a capturing pattern consumes the
      // character after the newline, which left one-character lines unjoined.
      .replace(/(?<=[^\n])\n(?=[^\n])/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

const WHITESPACE = /\s/;

function isSpace(text: string, index: number): boolean {
  return WHITESPACE.test(text[index] ?? '');
}

/** Shrinks a range so it neither starts nor ends on whitespace. */
function trimRange(text: string, start: number, end: number): Range | null {
  let from = start;
  let to = end;

  while (from < to && isSpace(text, from)) {
    from += 1;
  }
  while (to > from && isSpace(text, to - 1)) {
    to -= 1;
  }

  return to > from ? { start: from, end: to } : null;
}

function sentencesOf(text: string, paragraph: Range): Range[] {
  const body = text.slice(paragraph.start, paragraph.end);
  const ranges: Range[] = [];
  let cursor = 0;

  // Break after sentence-ending punctuation followed by whitespace.
  for (const match of body.matchAll(/(?<=[.!?])\s+/g)) {
    const sentence = trimRange(text, paragraph.start + cursor, paragraph.start + match.index);
    if (sentence) {
      ranges.push(sentence);
    }
    cursor = match.index + match[0].length;
  }

  const last = trimRange(text, paragraph.start + cursor, paragraph.end);
  if (last) {
    ranges.push(last);
  }

  return ranges;
}

/** Splits a range with no usable internal boundary into fixed-size pieces. */
function hardSplit(text: string, range: Range, maxChars: number): Range[] {
  const pieces: Range[] = [];

  for (let start = range.start; start < range.end; start += maxChars) {
    const piece = trimRange(text, start, Math.min(start + maxChars, range.end));
    if (piece) {
      pieces.push(piece);
    }
  }

  return pieces;
}

/** Breaks text into paragraph, sentence or hard-split ranges no longer than `maxChars`. */
function fragmentsOf(text: string, maxChars: number): Range[] {
  const fragments: Range[] = [];

  // Normalized text has no single newlines, so every line is a paragraph.
  for (const match of text.matchAll(/[^\n]+/g)) {
    const paragraph = trimRange(text, match.index, match.index + match[0].length);
    if (!paragraph) {
      continue;
    }

    if (paragraph.end - paragraph.start <= maxChars) {
      fragments.push(paragraph);
      continue;
    }

    for (const sentence of sentencesOf(text, paragraph)) {
      if (sentence.end - sentence.start <= maxChars) {
        fragments.push(sentence);
      } else {
        fragments.push(...hardSplit(text, sentence, maxChars));
      }
    }
  }

  return fragments;
}

/**
 * Chooses where the next chunk begins, reaching back into the previous chunk to
 * carry overlap.
 *
 * The overlap is clamped so the new chunk cannot exceed `maxChars`: oversized
 * passages risk silent truncation by the embedding API, which drops the tail of
 * a passage from the index while appearing to succeed. It always begins on a
 * word boundary, never mid-word.
 */
function overlapStart(
  text: string,
  previous: Range,
  next: Range,
  maxChars: number,
  overlapChars: number,
): number {
  if (overlapChars <= 0 || previous.end - previous.start <= overlapChars) {
    return next.start;
  }

  let start = Math.max(previous.end - overlapChars, next.end - maxChars, previous.start);
  if (start >= previous.end) {
    return next.start;
  }

  // Advance to the start of the next whole word.
  if (start > previous.start && !isSpace(text, start - 1)) {
    while (start < previous.end && !isSpace(text, start)) {
      start += 1;
    }
  }
  while (start < previous.end && isSpace(text, start)) {
    start += 1;
  }

  return start < previous.end ? start : next.start;
}

/**
 * Splits already-normalized text into retrieval-sized passages with offsets.
 *
 * @param normalized Output of `normalizeExtractedText`. Offsets refer to it.
 * @returns Passages in reading order. Empty when the input has no usable text.
 */
export function chunkSpans(normalized: string, options: ChunkOptions = {}): TextSpan[] {
  const { maxChars, overlapChars, minChars } = { ...DEFAULTS, ...options };

  if (normalized.length === 0) {
    return [];
  }

  const ranges: Range[] = [];
  let current: Range | null = null;

  for (const fragment of fragmentsOf(normalized, maxChars)) {
    if (!current) {
      current = { ...fragment };
      continue;
    }

    // Each chunk is one contiguous slice, so extending it simply moves the end.
    if (fragment.end - current.start <= maxChars) {
      current.end = fragment.end;
      continue;
    }

    ranges.push(current);
    current = {
      start: overlapStart(normalized, current, fragment, maxChars, overlapChars),
      end: fragment.end,
    };
  }

  if (current) {
    ranges.push(current);
  }

  const spans = ranges.map((range) => ({
    content: normalized.slice(range.start, range.end),
    start: range.start,
    end: range.end,
  }));

  // Keep a short chunk only when it is the entire document, so that a one-line
  // note is still retrievable while page furniture is discarded.
  if (spans.length === 1) {
    return spans;
  }

  return spans.filter((span) => span.content.length >= minChars);
}

/** Normalizes raw text and splits it into passages. */
export function chunkText(input: string, options: ChunkOptions = {}): string[] {
  return chunkSpans(normalizeExtractedText(input), options).map((span) => span.content);
}
