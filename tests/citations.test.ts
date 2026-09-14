import { describe, expect, it } from 'vitest';

import {
  UNRESOLVED_MARKER,
  citedOrdinals,
  countBrokenCitations,
  hasUnresolvedCitations,
  parseCitations,
  renumberCitations,
} from '@/lib/text/citations';

function ordinalsOf(text: string): number[][] {
  return parseCitations(text).flatMap((segment) =>
    segment.type === 'citation' ? [segment.ordinals] : [],
  );
}

describe('parseCitations', () => {
  it('recognises a single marker', () => {
    expect(ordinalsOf('A claim [S3].')).toEqual([[3]]);
  });

  it('recognises comma-grouped markers', () => {
    // The form the model actually produced in live testing, which the previous
    // renderer ignored entirely.
    expect(ordinalsOf('A claim [S1, S2].')).toEqual([[1, 2]]);
  });

  it('recognises semicolon-grouped markers', () => {
    expect(ordinalsOf('A claim [S1; S4].')).toEqual([[1, 4]]);
  });

  it.each([
    ['en dash', '[S2–S4]'],
    ['hyphen', '[S2-S4]'],
    ['spaced', '[S2 – S4]'],
  ])('expands a %s range', (_label, marker) => {
    expect(ordinalsOf(`Claim ${marker}.`)).toEqual([[2, 3, 4]]);
  });

  it('does not expand an implausibly wide range', () => {
    expect(ordinalsOf('Claim [S1–S900].')).toEqual([[1, 900]]);
  });

  it('deduplicates ordinals within one marker', () => {
    expect(ordinalsOf('Claim [S2, S2, S3].')).toEqual([[2, 3]]);
  });

  it('recognises an unresolved marker', () => {
    const [segment] = parseCitations('[S?]');
    expect(segment).toMatchObject({ type: 'citation', unresolved: true, ordinals: [] });
  });

  it('leaves other bracketed text alone', () => {
    expect(ordinalsOf('See [1], [Smith 2020] and [S] or [Sx].')).toEqual([]);
  });

  it('round-trips the original text', () => {
    const text = 'Opening [S1]. Middle [S2, S5] and [S3–S4]; end [S?].';
    const rebuilt = parseCitations(text)
      .map((segment) => (segment.type === 'text' ? segment.value : segment.raw))
      .join('');

    expect(rebuilt).toBe(text);
  });
});

describe('citedOrdinals', () => {
  it('returns every cited ordinal once, ascending', () => {
    expect(citedOrdinals('B [S3]. A [S1, S3]. C [S2–S3].')).toEqual([1, 2, 3]);
  });

  it('is empty for uncited prose', () => {
    expect(citedOrdinals('No citations here.')).toEqual([]);
  });
});

describe('hasUnresolvedCitations', () => {
  it('detects an unresolved marker', () => {
    expect(hasUnresolvedCitations('Claim [S?].')).toBe(true);
  });

  it('is false when every marker resolves', () => {
    expect(hasUnresolvedCitations('Claim [S1].')).toBe(false);
  });
});

describe('renumberCitations', () => {
  it('rewrites ordinals through the mapping', () => {
    const map = new Map([
      [1, 7],
      [2, 3],
    ]);
    expect(renumberCitations('A [S1]. B [S2].', (n) => map.get(n) ?? null)).toBe('A [S7]. B [S3].');
  });

  it('canonicalises grouped markers, sorted and comma-separated', () => {
    expect(renumberCitations('Claim [S2; S1].', (n) => n)).toBe('Claim [S1, S2].');
  });

  it('collapses ordinals that map to the same target', () => {
    expect(renumberCitations('Claim [S1, S2].', () => 4)).toBe('Claim [S4].');
  });

  it('marks a citation to a nonexistent source as unresolved rather than dropping it', () => {
    expect(renumberCitations('Claim [S12].', () => null)).toBe(`Claim ${UNRESOLVED_MARKER}.`);
  });

  it('keeps the resolvable part of a partly fabricated marker', () => {
    expect(renumberCitations('Claim [S1, S12].', (n) => (n === 1 ? 5 : null))).toBe(
      `Claim [S5]${UNRESOLVED_MARKER}.`,
    );
  });

  it('preserves an existing unresolved marker', () => {
    expect(renumberCitations('Claim [S?].', (n) => n)).toBe('Claim [S?].');
  });

  it('leaves text without markers untouched', () => {
    const text = 'Plain prose with [1] and (Smith, 2020).';
    expect(renumberCitations(text, (n) => n)).toBe(text);
  });
});

describe('countBrokenCitations', () => {
  it('is zero when every ordinal is known', () => {
    expect(countBrokenCitations('A [S1]. B [S2, S3].', new Set([1, 2, 3]))).toBe(0);
  });

  it('counts each ordinal with no matching citation', () => {
    expect(countBrokenCitations('A [S1, S4]. B [S5].', new Set([1]))).toBe(2);
  });

  it('counts explicit unresolved markers', () => {
    expect(countBrokenCitations('A [S?]. B [S1][S?].', new Set([1]))).toBe(2);
  });

  it('is zero for uncited prose', () => {
    expect(countBrokenCitations('Nothing cited.', new Set())).toBe(0);
  });
});
