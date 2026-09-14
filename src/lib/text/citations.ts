/**
 * MODULE: lib/text/citations
 *
 * Purpose
 *   Parse and rewrite the inline source markers — `[S3]` — that tie prose to
 *   the passages that support it.
 *
 * Accepted forms
 *   Models do not reliably follow one citation style, so every form seen in
 *   practice is recognised: `[S1]`, `[S1, S2]`, `[S1; S2]` and `[S1–S3]`.
 *   Previously only `[S1]` was recognised, so the grouped markers the model
 *   actually wrote rendered as raw text with no provenance attached.
 *
 * Unresolved markers
 *   `[S?]` marks a citation that points at no known source — typically a model
 *   citing `[S12]` when only ten sources were supplied. It is kept visible
 *   rather than silently dropped, because a claim with a fabricated citation
 *   must be reviewed, not disguised as uncited prose.
 *
 * Public: `parseCitations`, `citedOrdinals`, `hasUnresolvedCitations`,
 *   `countBrokenCitations`, `renumberCitations`, `UNRESOLVED_MARKER`,
 *   `CitationSegment`
 * Dependencies: none. Safe on server and client.
 */

export const UNRESOLVED_MARKER = '[S?]';

/** A range wider than this is treated as a typo rather than expanded. */
const MAX_RANGE_SPAN = 50;

const TOKEN = String.raw`S\d+(?:\s*[-–]\s*S\d+)?`;
const MARKER_SOURCE = String.raw`\[(S\?|${TOKEN}(?:\s*[,;]\s*${TOKEN})*)\]`;

function markerPattern(): RegExp {
  return new RegExp(MARKER_SOURCE, 'g');
}

export type CitationSegment =
  | { type: 'text'; value: string }
  | {
      type: 'citation';
      /** Source ordinals referenced, deduplicated, in the order written. */
      ordinals: number[];
      /** True for an explicit `[S?]` marker. */
      unresolved: boolean;
      raw: string;
    };

/** Expands the inside of one marker into ordinals. */
function expandMarker(body: string): number[] {
  if (body === 'S?') {
    return [];
  }

  const ordinals: number[] = [];

  for (const token of body.split(/[,;]/)) {
    const range = token.trim().match(/^S(\d+)\s*[-–]\s*S(\d+)$/);

    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);

      if (to >= from && to - from <= MAX_RANGE_SPAN) {
        for (let ordinal = from; ordinal <= to; ordinal += 1) {
          ordinals.push(ordinal);
        }
      } else {
        ordinals.push(from, to);
      }
      continue;
    }

    const single = token.trim().match(/^S(\d+)$/);
    if (single) {
      ordinals.push(Number(single[1]));
    }
  }

  return [...new Set(ordinals)];
}

/** Splits prose into alternating text and citation segments. */
export function parseCitations(text: string): CitationSegment[] {
  const segments: CitationSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(markerPattern())) {
    if (match.index > cursor) {
      segments.push({ type: 'text', value: text.slice(cursor, match.index) });
    }

    segments.push({
      type: 'citation',
      ordinals: expandMarker(match[1]),
      unresolved: match[1] === 'S?',
      raw: match[0],
    });

    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    segments.push({ type: 'text', value: text.slice(cursor) });
  }

  return segments;
}

/** Every ordinal cited anywhere in the text, ascending and unique. */
export function citedOrdinals(text: string): number[] {
  const ordinals = new Set<number>();

  for (const segment of parseCitations(text)) {
    if (segment.type === 'citation') {
      for (const ordinal of segment.ordinals) {
        ordinals.add(ordinal);
      }
    }
  }

  return [...ordinals].sort((a, b) => a - b);
}

export function hasUnresolvedCitations(text: string): boolean {
  return parseCitations(text).some(
    (segment) => segment.type === 'citation' && segment.unresolved,
  );
}

/**
 * Counts references in `text` that resolve to no known source: each explicit
 * `[S?]` marker, plus each ordinal absent from `known`.
 */
export function countBrokenCitations(text: string, known: ReadonlySet<number>): number {
  let broken = 0;

  for (const segment of parseCitations(text)) {
    if (segment.type !== 'citation') {
      continue;
    }

    if (segment.unresolved) {
      broken += 1;
    }

    broken += segment.ordinals.filter((ordinal) => !known.has(ordinal)).length;
  }

  return broken;
}

/**
 * Rewrites every marker through `map`, producing canonical `[S3, S7]` markers.
 *
 * An ordinal that maps to null becomes `[S?]`, so a citation to a source that
 * does not exist stays visible for review.
 */
export function renumberCitations(
  text: string,
  map: (ordinal: number) => number | null,
): string {
  return parseCitations(text)
    .map((segment) => {
      if (segment.type === 'text') {
        return segment.value;
      }

      if (segment.unresolved) {
        return UNRESOLVED_MARKER;
      }

      const mapped = segment.ordinals.map(map);
      const resolved = [...new Set(mapped.filter((value): value is number => value !== null))].sort(
        (a, b) => a - b,
      );
      const missing = mapped.some((value) => value === null) || resolved.length === 0;

      const marker =
        resolved.length > 0 ? `[${resolved.map((ordinal) => `S${ordinal}`).join(', ')}]` : '';

      return missing ? `${marker}${UNRESOLVED_MARKER}` : marker;
    })
    .join('');
}
