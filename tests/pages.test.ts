import { describe, expect, it } from 'vitest';

import { chunkSpans } from '@/lib/text/chunk';
import {
  formatPageRange,
  joinPages,
  pageAt,
  pageRangeOf,
  parsePageStarts,
  type PageStart,
} from '@/lib/text/pages';

describe('joinPages', () => {
  it('records where each page begins in the joined text', () => {
    const { text, pageStarts } = joinPages([
      { page: 1, text: 'First page.' },
      { page: 2, text: 'Second page.' },
    ]);

    expect(text).toBe('First page.\n\nSecond page.');
    expect(pageStarts).toEqual([
      [1, 0],
      [2, 13],
    ]);
    expect(text.slice(pageStarts[1][1])).toBe('Second page.');
  });

  it('skips pages that yield no text', () => {
    // Blank and image-only pages cannot be cited, so they get no entry.
    const { text, pageStarts } = joinPages([
      { page: 1, text: 'Intro.' },
      { page: 2, text: '   \n  ' },
      { page: 3, text: 'Body.' },
    ]);

    expect(text).toBe('Intro.\n\nBody.');
    expect(pageStarts.map(([page]) => page)).toEqual([1, 3]);
  });

  it('normalizes each page', () => {
    const { text } = joinPages([{ page: 1, text: 'wrapped\nline   here' }]);
    expect(text).toBe('wrapped line here');
  });

  it('returns empty output for a document with no text at all', () => {
    expect(joinPages([{ page: 1, text: '' }])).toEqual({ text: '', pageStarts: [] });
  });
});

describe('pageAt', () => {
  const starts: PageStart[] = [
    [1, 0],
    [2, 100],
    [5, 250],
  ];

  it('returns null with no page information', () => {
    expect(pageAt([], 10)).toBeNull();
  });

  it('returns null before the first page', () => {
    expect(pageAt([[1, 10]], 3)).toBeNull();
  });

  it('finds the page for an offset exactly at a page start', () => {
    expect(pageAt(starts, 100)).toBe(2);
  });

  it('finds the page for an offset inside a page', () => {
    expect(pageAt(starts, 99)).toBe(1);
    expect(pageAt(starts, 180)).toBe(2);
  });

  it('attributes everything after the last start to the last page', () => {
    expect(pageAt(starts, 10_000)).toBe(5);
  });
});

describe('pageRangeOf', () => {
  const starts: PageStart[] = [
    [1, 0],
    [2, 100],
  ];

  it('reports a single page for a range inside one page', () => {
    expect(pageRangeOf(starts, 10, 50)).toEqual({ pageStart: 1, pageEnd: 1 });
  });

  it('treats the end offset as exclusive', () => {
    expect(pageRangeOf(starts, 10, 100)).toEqual({ pageStart: 1, pageEnd: 1 });
  });

  it('reports both pages for a range crossing a boundary', () => {
    expect(pageRangeOf(starts, 90, 120)).toEqual({ pageStart: 1, pageEnd: 2 });
  });
});

describe('formatPageRange', () => {
  it('formats a single page', () => {
    expect(formatPageRange(4, 4)).toBe('p. 4');
    expect(formatPageRange(4, null)).toBe('p. 4');
  });

  it('formats a range with an en dash', () => {
    expect(formatPageRange(4, 6)).toBe('pp. 4–6');
  });

  it('renders nothing without a page', () => {
    expect(formatPageRange(null, null)).toBe('');
  });
});

describe('parsePageStarts', () => {
  it('parses a valid value', () => {
    expect(parsePageStarts('[[1,0],[2,40]]')).toEqual([
      [1, 0],
      [2, 40],
    ]);
  });

  it.each([
    ['null', null],
    ['empty', ''],
    ['invalid JSON', '[[1,0],'],
    ['not an array', '{"page":1}'],
    ['wrong tuple size', '[[1,0,3]]'],
    ['non-integer', '[[1,0.5]]'],
    ['page zero', '[[0,0]]'],
    ['unsorted offsets', '[[1,50],[2,10]]'],
    ['duplicate offsets', '[[1,0],[2,0]]'],
  ])('rejects %s', (_label, raw) => {
    // A corrupt value would otherwise produce confidently wrong page numbers.
    expect(parsePageStarts(raw)).toBeNull();
  });
});

describe('page-aware chunking', () => {
  it('maps a chunk back to the pages its text came from', () => {
    const pages = Array.from({ length: 4 }, (_, index) => ({
      page: index + 1,
      text: Array.from(
        { length: 8 },
        (_, sentence) => `Page ${index + 1} sentence ${sentence} about decoder thresholds.`,
      ).join(' '),
    }));

    const { text, pageStarts } = joinPages(pages);
    const spans = chunkSpans(text, { maxChars: 500, overlapChars: 100 });

    expect(spans.length).toBeGreaterThan(1);

    for (const span of spans) {
      const { pageStart, pageEnd } = pageRangeOf(pageStarts, span.start, span.end);

      // Every page the chunk claims must actually contribute text to it.
      expect(span.content).toContain(`Page ${pageStart} `);
      expect(span.content).toContain(`Page ${pageEnd} `);
    }
  });
});
