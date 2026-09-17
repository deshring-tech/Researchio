'use client';

import { useActionState } from 'react';

import { SubmitButton } from '@/components/ui/SubmitButton';
import { checkClaimsAction } from '@/server/actions/document.actions';
import {
  CLAIM_VERDICT_LABELS,
  FLAGGED_VERDICTS,
  countVerdicts,
  type ClaimCheckTarget,
  type ClaimReportView,
  type ClaimVerdict,
} from '@/lib/domain/claims';
import { claimProse } from '@/lib/text/claims';
import type { ActionResult } from '@/lib/errors';

/**
 * MODULE: components/workspace/ClaimReportPanel
 *
 * Purpose
 *   Summarise a claim check, list the claims that need review with the
 *   checker's reasons, and offer to check again.
 *
 * States are explicit
 *   A report for text that has since changed says so, rather than presenting
 *   verdicts against sentences that no longer exist. A check that has gone
 *   quiet is reported as interrupted rather than left spinning forever.
 */

const EXCERPT_CHARS = 180;

const PILL_TONE: Record<ClaimVerdict, string> = {
  supported: 'pill-success',
  partial: 'pill-warning',
  unsupported: 'pill-error',
  contradicted: 'pill-error',
  unresolved: 'pill-error',
  uncited_figure: 'pill-neutral',
  unchecked: 'pill-neutral',
};

/** Order in which verdicts are summarised: worst first. */
const SUMMARY_ORDER: ClaimVerdict[] = [
  'contradicted',
  'unsupported',
  'partial',
  'unresolved',
  'uncited_figure',
  'unchecked',
  'supported',
];

function excerpt(text: string): string {
  const prose = claimProse(text);
  return prose.length > EXCERPT_CHARS ? `${prose.slice(0, EXCERPT_CHARS - 1)}…` : prose;
}

export function ClaimReportPanel({
  sectionId,
  target,
  text,
  report,
}: {
  sectionId: string;
  target: ClaimCheckTarget;
  /** The exact text the report is for, as rendered. */
  text: string;
  report: ClaimReportView | null;
}) {
  const [state, action] = useActionState<ActionResult<undefined> | null, FormData>(
    checkClaimsAction,
    null,
  );

  if (text.length === 0) {
    return null;
  }

  const checkButton = (label: string) => (
    <form action={action}>
      <input type="hidden" name="sectionId" value={sectionId} />
      <input type="hidden" name="target" value={target} />
      <SubmitButton variant="ghost" size="sm" pendingLabel="Starting…">
        {label}
      </SubmitButton>
    </form>
  );

  const actionError =
    state && !state.ok ? (
      <p className="field-error" role="alert">
        {state.message}
      </p>
    ) : null;

  if (!report) {
    return (
      <div className="claim-report">
        <div className="claim-report-summary">
          <span>Claims have not been checked against their sources.</span>
          {checkButton('Check claims')}
        </div>
        {actionError}
      </div>
    );
  }

  if (!report.fresh) {
    return (
      <div className="claim-report">
        <div className="claim-report-summary">
          <span>The text has changed since its claims were checked.</span>
          {checkButton('Re-check claims')}
        </div>
        {actionError}
      </div>
    );
  }

  if (report.status === 'running') {
    return (
      <div className="claim-report" aria-live="polite">
        <div className="claim-report-summary">
          {report.stalled ? (
            <>
              <span>The last claim check was interrupted.</span>
              {checkButton('Re-check claims')}
            </>
          ) : (
            <span>
              <span className="spinner" aria-hidden="true" /> Checking each cited claim against its
              source…
            </span>
          )}
        </div>
        {actionError}
      </div>
    );
  }

  const counts = countVerdicts(report.results);
  const flagged = report.results.filter((result) => FLAGGED_VERDICTS.has(result.verdict));
  const summary = SUMMARY_ORDER.filter((verdict) => counts[verdict] > 0)
    .map((verdict) => `${counts[verdict]} ${CLAIM_VERDICT_LABELS[verdict].toLowerCase()}`)
    .join(' · ');

  return (
    <div className="claim-report" aria-live="polite">
      <div className="claim-report-summary">
        <span>
          {report.results.length === 0
            ? 'No cited claims to check.'
            : `${report.results.length} claim${report.results.length === 1 ? '' : 's'} checked: ${summary}`}
        </span>
        {checkButton('Re-check claims')}
      </div>

      {report.statusMessage ? (
        <p className={`text-sm ${report.status === 'failed' ? 'field-error' : 'muted'}`} style={{ margin: 0 }}>
          {report.statusMessage}
        </p>
      ) : null}

      {flagged.length > 0 ? (
        <ul className="claim-issues" aria-label="Claims that need review">
          {flagged.map((claim) => (
            <li key={`${claim.start}-${claim.key}`}>
              <span className={`pill ${PILL_TONE[claim.verdict]}`}>
                {CLAIM_VERDICT_LABELS[claim.verdict]}
              </span>
              <q>{excerpt(text.slice(claim.start, claim.end))}</q>
              {claim.reason ? <span className="claim-reason">{claim.reason}</span> : null}
            </li>
          ))}
        </ul>
      ) : counts.supported > 0 ? (
        <p className="text-sm" style={{ margin: 0, color: 'var(--success)' }}>
          Every checked claim is supported by the passage it cites.
        </p>
      ) : null}

      {actionError}
    </div>
  );
}
