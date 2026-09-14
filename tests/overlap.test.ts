import { describe, expect, it } from 'vitest';

import {
  RESTATEMENT_THRESHOLD,
  removeRestatedParagraphs,
  restatedShare,
} from '@/lib/text/overlap';

const EXISTING =
  'Under an independent depolarizing noise model the threshold of the surface code is approximately 1.1 percent [S1]. ' +
  'Below this rate, increasing the code distance suppresses the logical error rate exponentially [S1].';

describe('restatedShare', () => {
  it('is 1 for a verbatim repeat', () => {
    expect(restatedShare(EXISTING, EXISTING)).toBe(1);
  });

  it('is 0 for unrelated text', () => {
    expect(
      restatedShare('Zebrafish regenerate cardiac tissue through cardiomyocyte proliferation.', EXISTING),
    ).toBe(0);
  });

  it('ignores citation markers, which are renumbered between drafts', () => {
    const renumbered = EXISTING.replace(/\[S1\]/g, '[S4, S5]');
    expect(restatedShare(renumbered, EXISTING)).toBe(1);
  });

  it('ignores case and punctuation', () => {
    expect(restatedShare(EXISTING.toUpperCase().replace(/\./g, ';'), EXISTING)).toBe(1);
  });

  it('is 0 for empty input', () => {
    expect(restatedShare('   ', EXISTING)).toBe(0);
  });
});

describe('removeRestatedParagraphs', () => {
  const fresh =
    'A correlation-aware decoder recovered the threshold to 0.95 percent at a coefficient of 0.3 [S2].';

  it('drops a verbatim repeat and keeps new material', () => {
    // The failure seen in live testing: the extension restated the whole section.
    const result = removeRestatedParagraphs(`${EXISTING}\n\n${fresh}`, EXISTING);

    expect(result.removed).toBe(1);
    expect(result.text).toBe(fresh);
  });

  it('drops a near-verbatim repeat with a word changed', () => {
    const tweaked = EXISTING.replace('approximately', 'roughly');
    expect(removeRestatedParagraphs(tweaked, EXISTING).removed).toBe(1);
  });

  it('keeps a new paragraph on the same topic', () => {
    const result = removeRestatedParagraphs(fresh, EXISTING);
    expect(result).toEqual({ text: fresh, removed: 0 });
  });

  it('returns empty text when every paragraph restates the section', () => {
    const result = removeRestatedParagraphs(`${EXISTING}\n\n${EXISTING}`, EXISTING);
    expect(result).toEqual({ text: '', removed: 2 });
  });

  it('keeps everything when there is no existing text', () => {
    expect(removeRestatedParagraphs(`${EXISTING}\n\n${fresh}`, '')).toEqual({
      text: `${EXISTING}\n\n${fresh}`,
      removed: 0,
    });
  });

  it('normalizes paragraph spacing in the output', () => {
    const result = removeRestatedParagraphs(`\n\n${fresh}\n \n\n${fresh.replace('0.95', '0.97')}\n`, EXISTING);
    expect(result.text.split('\n\n')).toHaveLength(2);
  });

  it('honours a custom threshold', () => {
    const half = `${EXISTING} ${fresh}`;
    const share = restatedShare(half, EXISTING);

    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThan(RESTATEMENT_THRESHOLD + 0.3);
    expect(removeRestatedParagraphs(half, EXISTING, share - 0.01).removed).toBe(1);
    expect(removeRestatedParagraphs(half, EXISTING, share + 0.01).removed).toBe(0);
  });
});
