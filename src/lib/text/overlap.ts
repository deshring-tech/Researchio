import { parseCitations } from '@/lib/text/citations';

/**
 * MODULE: lib/text/overlap
 *
 * Purpose
 *   Detect paragraphs of a proposed extension that merely restate text the
 *   section already contains.
 *
 * Why
 *   "Extend with AI" appends the draft to the researcher's prose. Models asked
 *   to extend a passage frequently rewrite it in full, and appending that
 *   duplicates the section. Live testing produced exactly this: an accepted
 *   extension repeated the entire existing section verbatim.
 *
 * Method
 *   Word 5-gram shingles, compared after removing citation markers and
 *   punctuation and folding case. A paragraph whose shingles mostly already
 *   occur in the existing text is a restatement. This is deterministic and
 *   cheap, and catches verbatim and near-verbatim repetition. It does not catch
 *   free paraphrase; the drafting prompt carries that part of the burden.
 *
 * Public: `removeRestatedParagraphs`, `restatedShare`, `RESTATEMENT_THRESHOLD`
 * Dependencies: lib/text/citations. Safe on server and client.
 */

const SHINGLE_WORDS = 5;

/** Share of a paragraph's shingles already present at which it counts as restated. */
export const RESTATEMENT_THRESHOLD = 0.6;

function tokens(text: string): string[] {
  const withoutMarkers = parseCitations(text)
    .map((segment) => (segment.type === 'text' ? segment.value : ' '))
    .join('');

  return withoutMarkers
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function shingles(words: readonly string[]): Set<string> {
  const set = new Set<string>();

  if (words.length < SHINGLE_WORDS) {
    if (words.length > 0) {
      set.add(words.join(' '));
    }
    return set;
  }

  for (let start = 0; start + SHINGLE_WORDS <= words.length; start += 1) {
    set.add(words.slice(start, start + SHINGLE_WORDS).join(' '));
  }

  return set;
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

/** Fraction, from 0 to 1, of `paragraph`'s shingles that already occur in `existing`. */
export function restatedShare(paragraph: string, existing: string): number {
  const candidate = shingles(tokens(paragraph));
  if (candidate.size === 0) {
    return 0;
  }

  const known = shingles(tokens(existing));
  let repeated = 0;

  for (const shingle of candidate) {
    if (known.has(shingle)) {
      repeated += 1;
    }
  }

  return repeated / candidate.size;
}

/**
 * Drops each paragraph of `draft` that restates `existing`.
 *
 * @returns The remaining paragraphs joined by blank lines, and how many were
 *   dropped. An empty `text` means the draft added nothing new.
 */
export function removeRestatedParagraphs(
  draft: string,
  existing: string,
  threshold = RESTATEMENT_THRESHOLD,
): { text: string; removed: number } {
  const paragraphs = splitParagraphs(draft);

  if (tokens(existing).length === 0) {
    return { text: paragraphs.join('\n\n'), removed: 0 };
  }

  const kept = paragraphs.filter((paragraph) => restatedShare(paragraph, existing) < threshold);

  return { text: kept.join('\n\n'), removed: paragraphs.length - kept.length };
}
