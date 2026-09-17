/**
 * MODULE: lib/domain/claims
 *
 * Purpose
 *   The vocabulary of claim verification, shared by the verification service,
 *   the living document and the completion checklist.
 *
 * Dependencies: none. Safe on server and client.
 */

export const CLAIM_VERDICTS = [
  /** Every factual element is stated in, or directly entailed by, the cited passages. */
  'supported',
  /** Some elements are supported; at least one is not found in the passages. */
  'partial',
  /** The cited passages do not establish the claim. */
  'unsupported',
  /** The cited passages state something incompatible with the claim. */
  'contradicted',
  /** The claim cites no source that exists. Decided without a model. */
  'unresolved',
  /** A percentage or decimal figure stated with no citation. Decided without a model. */
  'uncited_figure',
  /** Not yet judged — the provider was unavailable or returned no verdict. */
  'unchecked',
] as const;

export type ClaimVerdict = (typeof CLAIM_VERDICTS)[number];

/** Verdicts where the sources, as cited, do not bear the claim out. */
export const DISPUTED_VERDICTS: ReadonlySet<ClaimVerdict> = new Set([
  'partial',
  'unsupported',
  'contradicted',
]);

/** Everything that should be highlighted for the researcher's review. */
export const FLAGGED_VERDICTS: ReadonlySet<ClaimVerdict> = new Set([
  ...DISPUTED_VERDICTS,
  'unresolved',
  'uncited_figure',
]);

export const CLAIM_VERDICT_LABELS: Record<ClaimVerdict, string> = {
  supported: 'Supported',
  partial: 'Partly supported',
  unsupported: 'Not supported',
  contradicted: 'Contradicted',
  unresolved: 'No such source',
  uncited_figure: 'Uncited figure',
  unchecked: 'Not checked',
};

export const CLAIM_CHECK_TARGETS = ['draft', 'document'] as const;
export type ClaimCheckTarget = (typeof CLAIM_CHECK_TARGETS)[number];

export const CLAIM_CHECK_STATUSES = ['running', 'complete', 'failed'] as const;
export type ClaimCheckStatus = (typeof CLAIM_CHECK_STATUSES)[number];

export interface ClaimResult {
  /** Offsets of the claim within the checked text. */
  start: number;
  end: number;
  /** Ordinals the claim cites, as written. */
  ordinals: number[];
  verdict: ClaimVerdict;
  /** One-sentence explanation from the checker. Null for deterministic verdicts. */
  reason: string | null;
  /** Identifies the claim's wording and evidence, so an unchanged claim is not re-checked. */
  key: string;
}

/** What the document view needs to present a report. */
export interface ClaimReportView {
  status: ClaimCheckStatus;
  /** False once the text has changed since the check ran; offsets then no longer apply. */
  fresh: boolean;
  /** True for a check that has been running long enough to be presumed dead. */
  stalled: boolean;
  checkedAt: string;
  statusMessage: string | null;
  results: ClaimResult[];
}

export function countVerdicts(results: readonly ClaimResult[]): Record<ClaimVerdict, number> {
  const counts = Object.fromEntries(CLAIM_VERDICTS.map((verdict) => [verdict, 0])) as Record<
    ClaimVerdict,
    number
  >;

  for (const result of results) {
    counts[result.verdict] += 1;
  }

  return counts;
}

/**
 * Disputed claims in a report that is current. A stale or still-running report
 * says nothing reliable about the text as it stands, so it counts as none.
 */
export function countDisputedClaims(report: ClaimReportView | null): number {
  if (!report || !report.fresh || report.status === 'running') {
    return 0;
  }

  return report.results.filter((result) => DISPUTED_VERDICTS.has(result.verdict)).length;
}
