import { describe, expect, it } from 'vitest';

import { chunkText, normalizeExtractedText } from '@/lib/text/chunk';

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

  it('preserves paragraph breaks', () => {
    expect(normalizeExtractedText('para one\n\npara two')).toBe('para one\n\npara two');
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
    // Oversized chunks risk silent truncation by the embedding API, which
    // would drop the tail of a passage from the index while appearing to work.
    for (const chunk of chunkText(longText, { maxChars: 400, overlapChars: 80 })) {
      expect(chunk.length).toBeLessThanOrEqual(400);
    }
  });

  it('holds the limit when overlap is large relative to chunk size', () => {
    for (const chunk of chunkText(longText, { maxChars: 200, overlapChars: 180 })) {
      expect(chunk.length).toBeLessThanOrEqual(200);
    }
  });

  it('never emits empty or whitespace-only chunks', () => {
    for (const chunk of chunkText(longText, { maxChars: 300 })) {
      expect(chunk.trim().length).toBeGreaterThan(0);
    }
  });

  it('overlaps consecutive chunks so a claim spanning a boundary stays findable', () => {
    const chunks = chunkText(longText, { maxChars: 400, overlapChars: 120 });
    expect(chunks.length).toBeGreaterThan(1);

    // Some trailing text of one chunk must reappear in the next, otherwise a
    // sentence split across the boundary is retrievable from neither.
    const tailWords = chunks[0].split(' ').slice(-3);
    expect(tailWords.some((word) => chunks[1].includes(word))).toBe(true);
  });

  it('hard-splits a single sentence longer than the limit', () => {
    const runOn = 'word '.repeat(500).trim();
    const chunks = chunkText(runOn, { maxChars: 200 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(200);
    }
  });

  it('drops page furniture when real content exists', () => {
    const withNoise = `${'Substantial paragraph. '.repeat(30)}\n\n7\n\n${'More substance here. '.repeat(30)}`;
    const chunks = chunkText(withNoise, { maxChars: 400, minChars: 60 });

    expect(chunks.some((chunk) => chunk.trim() === '7')).toBe(false);
  });
});
