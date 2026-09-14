import { normalizeExtractedText } from '@/lib/text/chunk';

/**
 * MODULE: lib/text/pages
 *
 * Purpose
 *   Track which page of a source document each character of its extracted
 *   text came from, so a passage — and therefore a citation — can name a page.
 *
 * Representation
 *   `PageStart[]` is a list of `[pageNumber, offset]` pairs, sorted by offset,
 *   one per page that produced any text. The page containing an offset is the
 *   last entry whose start is at or before it. Pages that yield no text (blank
 *   or image-only) have no entry and can never be cited, which is correct.
 *
 * Public: `joinPages`, `pageAt`, `pageRangeOf`, `formatPageRange`,
 *   `parsePageStarts`, `PageStart`
 * Dependencies: lib/text/chunk. Safe on server and client.
 */

export type PageStart = readonly [page: number, start: number];

/** Separates pages in the joined text. Matches a normalized paragraph break. */
const PAGE_SEPARATOR = '\n\n';

/**
 * Normalizes each page and joins them, recording where every page begins.
 *
 * Each page is normalized on its own and joined with a paragraph break, so the
 * result is itself normalized text and the recorded offsets remain valid.
 */
export function joinPages(pages: ReadonlyArray<{ page: number; text: string }>): {
  text: string;
  pageStarts: PageStart[];
} {
  let text = '';
  const pageStarts: PageStart[] = [];

  for (const entry of pages) {
    const normalized = normalizeExtractedText(entry.text);
    if (normalized.length === 0) {
      continue;
    }

    if (text.length > 0) {
      text += PAGE_SEPARATOR;
    }

    pageStarts.push([entry.page, text.length]);
    text += normalized;
  }

  return { text, pageStarts };
}

/** The page containing `offset`, or null when no page information exists. */
export function pageAt(pageStarts: readonly PageStart[], offset: number): number | null {
  if (pageStarts.length === 0 || offset < pageStarts[0][1]) {
    return null;
  }

  // Binary search for the last page starting at or before the offset.
  let low = 0;
  let high = pageStarts.length - 1;

  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (pageStarts[middle][1] <= offset) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }

  return pageStarts[low][0];
}

/** Pages spanned by the half-open range `[start, end)`. */
export function pageRangeOf(
  pageStarts: readonly PageStart[],
  start: number,
  end: number,
): { pageStart: number | null; pageEnd: number | null } {
  return {
    pageStart: pageAt(pageStarts, start),
    pageEnd: pageAt(pageStarts, Math.max(start, end - 1)),
  };
}

/** Renders a page range in citation style: "p. 4", "pp. 4–5", or "". */
export function formatPageRange(pageStart: number | null, pageEnd: number | null): string {
  if (pageStart === null) {
    return '';
  }

  return pageEnd === null || pageEnd === pageStart
    ? `p. ${pageStart}`
    : `pp. ${pageStart}–${pageEnd}`;
}

/**
 * Parses stored page starts, returning null for anything malformed.
 *
 * Validated rather than trusted: a corrupt value would otherwise produce
 * confidently wrong page numbers in citations, which is worse than none.
 */
export function parsePageStarts(raw: string | null | undefined): PageStart[] | null {
  if (!raw) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) {
    return null;
  }

  let previousStart = -1;
  const result: PageStart[] = [];

  for (const entry of parsed) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      !Number.isInteger(entry[0]) ||
      !Number.isInteger(entry[1]) ||
      entry[0] < 1 ||
      entry[1] <= previousStart
    ) {
      return null;
    }

    previousStart = entry[1];
    result.push([entry[0], entry[1]]);
  }

  return result;
}
