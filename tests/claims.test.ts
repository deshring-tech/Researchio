import { describe, expect, it } from 'vitest';

import {
  countDisputedClaims,
  countVerdicts,
  type ClaimReportView,
  type ClaimResult,
} from '@/lib/domain/claims';
import { claimProse, extractClaims } from '@/lib/text/claims';

describe('extractClaims', () => {
  it('returns each cited sentence as an exact slice of the text', () => {
    const text = 'The threshold is 1.1 percent [S1]. Correlated noise lowers it [S2].';
    const claims = extractClaims(text);

    expect(claims).toHaveLength(2);
    for (const claim of claims) {
      expect(text.slice(claim.start, claim.end)).toBe(claim.text);
    }
  });

  it('keeps a marker placed before the full stop with its sentence', () => {
    const [claim] = extractClaims('Cardiomyocytes re-enter the cell cycle [S1]. Uncited remark.');
    expect(claim.text).toBe('Cardiomyocytes re-enter the cell cycle [S1].');
    expect(claim.ordinals).toEqual([1]);
  });

  it('collects grouped and repeated ordinals once each', () => {
    const [claim] = extractClaims('Both agree on this [S2, S1] and again [S2].');
    expect(claim.ordinals).toEqual([2, 1]);
  });

  it('skips uncited sentences that state no figure', () => {
    expect(extractClaims('This framing motivates the study. It is widely discussed.')).toEqual([]);
  });

  it('ignores whole numbers, which are rarely findings', () => {
    expect(extractClaims('We used distance 7 patches across 3 devices.')).toEqual([]);
  });

  it.each([
    ['a percentage', 'Regeneration succeeded in 85 percent of animals.'],
    ['a percent sign', 'Regeneration succeeded in 85% of animals.'],
    ['a decimal', 'The coefficient was 0.3 in every run.'],
  ])('flags an uncited sentence stating %s', (_label, text) => {
    const [claim] = extractClaims(text);
    expect(claim).toMatchObject({ uncitedFigure: true, ordinals: [], unresolved: false });
  });

  it('does not flag figures in an evidence gap paragraph', () => {
    const text = 'Evidence gap: no data exists beyond 0.1 percent.\n\nThe threshold is 1.1 percent [S1].';
    const claims = extractClaims(text);

    expect(claims).toHaveLength(1);
    expect(claims[0].ordinals).toEqual([1]);
  });

  it('still returns cited claims inside an evidence gap paragraph', () => {
    const claims = extractClaims('Evidence gap: sources lack hardware data, though one simulation exists [S2].');
    expect(claims).toHaveLength(1);
    expect(claims[0].ordinals).toEqual([2]);
  });

  it.each([
    'Fowler et al. showed that errors fall sharply [S1].',
    'Some decoders, e.g. matching decoders, ignore correlation [S1].',
    'The curve in Fig. 3 flattens above threshold [S1].',
    'As K. Poss reported, regeneration is rapid [S1].',
  ])('does not split after an abbreviation: %s', (text) => {
    const claims = extractClaims(text);
    expect(claims).toHaveLength(1);
    expect(claims[0].text).toBe(text);
  });

  it('treats a paragraph break as a sentence boundary', () => {
    const claims = extractClaims('A heading-like claim with no stop [S1]\n\nA second claim [S2].');
    expect(claims.map((claim) => claim.ordinals)).toEqual([[1], [2]]);
  });

  it('keeps a single-newline wrap within one sentence', () => {
    const claims = extractClaims('A claim that wraps\nonto a second line [S1].');
    expect(claims).toHaveLength(1);
  });

  it('marks an explicit unresolved marker', () => {
    const [claim] = extractClaims('Mammalian hearts regenerate fully [S?].');
    expect(claim).toMatchObject({ unresolved: true, ordinals: [] });
  });

  it('returns nothing for empty text', () => {
    expect(extractClaims('')).toEqual([]);
  });
});

describe('claimProse', () => {
  it('removes markers and tidies the spacing they leave', () => {
    expect(claimProse('The threshold falls [S1, S2] under correlation [S3].')).toBe(
      'The threshold falls under correlation.',
    );
  });
});

function result(verdict: ClaimResult['verdict']): ClaimResult {
  return { start: 0, end: 1, ordinals: [1], verdict, reason: null, key: verdict };
}

function report(overrides: Partial<ClaimReportView>): ClaimReportView {
  return {
    status: 'complete',
    fresh: true,
    stalled: false,
    checkedAt: '2026-09-15T00:00:00.000Z',
    statusMessage: null,
    results: [result('supported'), result('partial'), result('unsupported'), result('uncited_figure')],
    ...overrides,
  };
}

describe('countVerdicts', () => {
  it('counts every verdict, including those absent', () => {
    const counts = countVerdicts([result('supported'), result('supported'), result('contradicted')]);
    expect(counts).toMatchObject({ supported: 2, contradicted: 1, partial: 0, unchecked: 0 });
  });
});

describe('countDisputedClaims', () => {
  it('counts partial, unsupported and contradicted claims in a current report', () => {
    expect(countDisputedClaims(report({}))).toBe(2);
  });

  it('counts nothing for a stale report, whose offsets no longer apply', () => {
    expect(countDisputedClaims(report({ fresh: false }))).toBe(0);
  });

  it('counts nothing while a check is running', () => {
    expect(countDisputedClaims(report({ status: 'running' }))).toBe(0);
  });

  it('counts nothing without a report', () => {
    expect(countDisputedClaims(null)).toBe(0);
  });
});
