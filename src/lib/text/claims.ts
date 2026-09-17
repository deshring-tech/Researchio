import { parseCitations } from '@/lib/text/citations';

/**
 * MODULE: lib/text/claims
 *
 * Purpose
 *   Split prose into the claims a verifier should check: sentences carrying
 *   citation markers, and sentences stating a figure with no citation at all.
 *
 * Sentence boundaries
 *   A sentence ends at `.`, `!` or `?` followed by whitespace, or at a
 *   paragraph break — except after common scholarly abbreviations ("et al.",
 *   "e.g.", "Fig.") and single-letter initials, where splitting would separate a
 *   claim from its own subject and leave the verifier judging a fragment.
 *
 * Evidence gaps
 *   A paragraph beginning "Evidence gap:" describes what the sources lack. Its
 *   figures restate the corpus rather than assert findings, so they are not
 *   flagged as uncited; cited claims inside it are still returned.
 *
 * Public: `extractClaims`, `claimProse`, `ClaimCandidate`
 * Dependencies: lib/text/citations. Safe on server and client.
 */

export interface ClaimCandidate {
  /** Offsets of the sentence within the text. */
  start: number;
  end: number;
  text: string;
  /** Cited ordinals, unique, in the order written. */
  ordinals: number[];
  /** True when the sentence contains an explicit `[S?]` marker. */
  unresolved: boolean;
  /** True for an uncited sentence stating a percentage or decimal figure. */
  uncitedFigure: boolean;
}

interface Range {
  start: number;
  end: number;
}

/** Text ending in one of these is not the end of a sentence. */
const ABBREVIATION =
  /(?:^|[\s(])(?:et al|e\.g|i\.e|cf|vs|approx|ca|fig|figs|eq|eqs|no|dr|prof|st|[a-z])\.$/i;

/** A percentage, or a number with a decimal part. */
const FIGURE = /\d\s*(?:%|percent\b|per cent\b)|\b\d+\.\d+\b/i;

const EVIDENCE_GAP = /^evidence gap\s*:/i;

function trimmed(text: string, start: number, end: number): Range | null {
  let from = start;
  let to = end;

  while (from < to && /\s/.test(text[from])) {
    from += 1;
  }
  while (to > from && /\s/.test(text[to - 1])) {
    to -= 1;
  }

  return to > from ? { start: from, end: to } : null;
}

function sentencesIn(text: string, paragraph: Range): Range[] {
  const body = text.slice(paragraph.start, paragraph.end);
  const ranges: Range[] = [];
  let cursor = 0;

  // Terminal punctuation, optionally followed by closing quotes or brackets.
  for (const match of body.matchAll(/[.!?]["'’”)\]]*\s+/g)) {
    if (body[match.index] === '.' && ABBREVIATION.test(body.slice(0, match.index + 1))) {
      continue;
    }

    const end = match.index + match[0].trimEnd().length;
    const sentence = trimmed(text, paragraph.start + cursor, paragraph.start + end);
    if (sentence) {
      ranges.push(sentence);
    }
    cursor = match.index + match[0].length;
  }

  const last = trimmed(text, paragraph.start + cursor, paragraph.end);
  if (last) {
    ranges.push(last);
  }

  return ranges;
}

/** Claim wording without its citation markers, with spacing tidied. */
export function claimProse(text: string): string {
  return parseCitations(text)
    .map((segment) => (segment.type === 'text' ? segment.value : ' '))
    .join('')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractClaims(text: string): ClaimCandidate[] {
  const claims: ClaimCandidate[] = [];

  // A paragraph is any run of text containing no blank line.
  for (const match of text.matchAll(/(?:[^\n]|\n(?![ \t]*\n))+/g)) {
    const paragraph = trimmed(text, match.index, match.index + match[0].length);
    if (!paragraph) {
      continue;
    }

    const isEvidenceGap = EVIDENCE_GAP.test(text.slice(paragraph.start, paragraph.end));

    for (const range of sentencesIn(text, paragraph)) {
      const sentence = text.slice(range.start, range.end);
      const ordinals = new Set<number>();
      let unresolved = false;

      for (const segment of parseCitations(sentence)) {
        if (segment.type !== 'citation') {
          continue;
        }
        unresolved ||= segment.unresolved;
        for (const ordinal of segment.ordinals) {
          ordinals.add(ordinal);
        }
      }

      const cited = ordinals.size > 0 || unresolved;
      const uncitedFigure = !cited && !isEvidenceGap && FIGURE.test(claimProse(sentence));

      if (cited || uncitedFigure) {
        claims.push({
          start: range.start,
          end: range.end,
          text: sentence,
          ordinals: [...ordinals],
          unresolved,
          uncitedFigure,
        });
      }
    }
  }

  return claims;
}
