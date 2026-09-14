import { describe, expect, it } from 'vitest';

import { chunkSpans, chunkText, normalizeExtractedText } from '@/lib/text/chunk';

describe('normalizeExtractedText', () => {
  it('rejoins words hyphenated across a line break', () => {
    // The dominant PDF extraction artifact: without this, "correction" is
    // indexed as two fragments and never matches a query.
    expect(normalizeExtractedText('quantum error correc-\ntion is hard')).toContain(
      'correction',
    );
  });

  it('treats a single newline as a wrapped line, not a paragraph', () => {
    expect(normalizeExtractedText('first line\nsecond line')).toBe('first line second line');
  });

  it('joins one-character wrapped lines', () => {
    // A capturing regex consumed the character after each newline, leaving
    // alternate newlines in place for short lines such as table cells.
    expect(normalizeExtractedText('a\nb\nc\nd')).toBe('a b c d');
  });

  it('preserves paragraph breaks', () => {
    expect(normalizeExtractedText('para one\n\npara two')).toBe('para one\n\npara two');
  });

  it('treats a whitespace-only line as a paragraph break', () => {
    expect(normalizeExtractedText('para one\n \t \npara two')).toBe('para one\n\npara two');
  });

  it('collapses runs of blank lines', () => {
    expect(normalizeExtractedText('a\n\n\n\n\nb')).toBe('a\n\nb');
  });

  it('collapses repeated spaces and tabs', () => {
    expect(normalizeExtractedText('a     b\t\tc')).toBe('a b c');
  });

  it('normalizes Windows line endings', () => {
    expect(normalizeExtractedText('a\r\n\r\nb')).toBe('a\n\nb');
  });

  it('is idempotent, so offsets into normalized text stay valid', () => {
    const messy = ' Title \n\n\n body-\ntext wraps\nhere  \n \n next para \r\n end ';
    const once = normalizeExtractedText(messy);
    expect(normalizeExtractedText(once)).toBe(once);
  });
});

describe('chunkSpans', () => {
  const text = normalizeExtractedText(
    Array.from(
      { length: 12 },
      (_, paragraph) =>
        Array.from(
          { length: 6 },
          (_, sentence) =>
            `Paragraph ${paragraph} sentence ${sentence} discusses surface code thresholds.`,
        ).join(' '),
    ).join('\n\n'),
  );

  it('produces spans that are exact slices of the input', () => {
    // This is the property page mapping depends on.
    for (const span of chunkSpans(text, { maxChars: 500 })) {
      expect(text.slice(span.start, span.end)).toBe(span.content);
    }
  });

  it('emits spans in reading order', () => {
    const spans = chunkSpans(text, { maxChars: 500 });
    for (let index = 1; index < spans.length; index += 1) {
      expect(spans[index].start).toBeGreaterThan(spans[index - 1].start);
    }
  });

  it('never starts or ends a span on whitespace', () => {
    for (const span of chunkSpans(text, { maxChars: 300, overlapChars: 120 })) {
      expect(span.content).toBe(span.content.trim());
    }
  });

  it('never exceeds maxChars', () => {
    for (const span of chunkSpans(text, { maxChars: 300, overlapChars: 250 })) {
      expect(span.content.length).toBeLessThanOrEqual(300);
    }
  });

  it('starts overlap on a word boundary', () => {
    const spans = chunkSpans(text, { maxChars: 400, overlapChars: 150 });
    expect(spans.length).toBeGreaterThan(1);

    for (const span of spans.slice(1)) {
      const before = text[span.start - 1];
      expect(before === undefined || /\s/.test(before)).toBe(true);
    }
  });

  it('covers the whole document with no gaps between consecutive spans', () => {
    const spans = chunkSpans(text, { maxChars: 400, overlapChars: 100, minChars: 0 });
    expect(spans[0].start).toBe(0);
    expect(spans.at(-1)?.end).toBe(text.length);

    for (let index = 1; index < spans.length; index += 1) {
      // Each span begins at or before the previous one's end (overlap), or
      // immediately after only whitespace separating them.
      const gap = text.slice(spans[index - 1].end, spans[index].start);
      expect(spans[index].start <= spans[index - 1].end || gap.trim() === '').toBe(true);
    }
  });

  it('returns nothing for empty input', () => {
    expect(chunkSpans('')).toEqual([]);
  });
});

describe('chunkText', () => {
  const longText = Array.from(
    { length: 40 },
    (_, index) => `Sentence ${index} concerns surface codes and noise thresholds in qubits.`,
  ).join(' ');

  it('returns nothing for blank input', () => {
    expect(chunkText('   \n\n  ')).toEqual([]);
  });

  it('keeps a short note as a single chunk', () => {
    // A one-line note is below `minChars` but is the whole document, so
    // dropping it would make the user's own notes unsearchable.
    expect(chunkText('One short note.')).toEqual(['One short note.']);
  });

  it('splits long text into multiple chunks', () => {
    expect(chunkText(longText, { maxChars: 400 }).length).toBeGreaterThan(1);
  });

  it('never exceeds maxChars, even with overlap carried in', () => {
    for (const chunk of chunkText(longText, { maxChars: 400, overlapChars: 80 })) {
      expect(chunk.length).toBeLessThanOrEqual(400);
    }
  });

  it('holds the limit when overlap is large relative to chunk size', () => {
    for (const chunk of chunkText(longText, { maxChars: 200, overlapChars: 180 })) {
      expect(chunk.length).toBeLessThanOrEqual(200);
    }
  });

  it('overlaps consecutive chunks so a claim spanning a boundary stays findable', () => {
    const chunks = chunkText(longText, { maxChars: 400, overlapChars: 120 });
    expect(chunks.length).toBeGreaterThan(1);

    // The opening words of each later chunk must also appear at the end of
    // the chunk before it.
    for (let index = 1; index < chunks.length; index += 1) {
      const lead = chunks[index].split(' ').slice(0, 3).join(' ');
      expect(chunks[index - 1]).toContain(lead);
    }
  });

  it('hard-splits a single sentence longer than the limit', () => {
    const runOn = 'word '.repeat(500).trim();
    const chunks = chunkText(runOn, { maxChars: 200 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(200);
    }
  });

  it('never emits empty or whitespace-only chunks', () => {
    for (const chunk of chunkText(longText, { maxChars: 300 })) {
      expect(chunk.trim().length).toBeGreaterThan(0);
    }
  });

  it('does not emit page furniture as a chunk of its own', () => {
    const withNoise = `${'Substantial paragraph. '.repeat(30)}\n\n7\n\n${'More substance here. '.repeat(30)}`;
    const chunks = chunkText(withNoise, { maxChars: 400, minChars: 60 });

    expect(chunks.some((chunk) => chunk.trim() === '7')).toBe(false);
  });
});
