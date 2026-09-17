'use client';

import { useActionState } from 'react';

import { useRefreshWhile } from '@/hooks/useRefreshWhile';

import { SubmitButton } from '@/components/ui/SubmitButton';
import { deletePaperAction, retryPaperAction } from '@/server/actions/paper.actions';
import {
  INGESTION_STATUS_LABELS,
  asIngestionStatus,
  type IngestionStatus,
} from '@/lib/domain/constants';
import { formatDate, formatFileSize } from '@/lib/format';
import type { ActionResult } from '@/lib/errors';

/**
 * MODULE: components/workspace/PaperList
 *
 * Purpose
 *   Show uploaded sources, their ingestion progress, and the analysis produced
 *   for each.
 *
 * Live updates
 *   Ingestion runs in the background, so while any document is still queued or
 *   processing the list refreshes the server component on an interval. Polling
 *   stops as soon as everything settles, so an idle page costs nothing.
 *
 *   Polling was chosen over websockets deliberately: it is a handful of lines,
 *   survives restarts, and the update latency it costs is irrelevant for a job
 *   that takes tens of seconds.
 */


export interface PaperView {
  id: string;
  title: string;
  authors: string | null;
  year: number | null;
  originalName: string;
  sizeBytes: number;
  status: string;
  statusMessage: string | null;
  createdAt: string;
  pageCount: number | null;
  plainSummary: string | null;
  techSummary: string | null;
  keyFindings: string | null;
  methodology: string | null;
  limitations: string | null;
  chunkCount: number;
  /**
   * False for a PDF indexed before page tracking. Its citations cannot name a
   * page until it is extracted again.
   */
  hasPageNumbers: boolean;
}

const PILL_TONE: Record<IngestionStatus, string> = {
  pending: 'pill-neutral',
  processing: 'pill-warning',
  ready: 'pill-success',
  failed: 'pill-error',
};

export function PaperList({ papers }: { papers: PaperView[] }) {
  const isSettling = papers.some((paper) => {
    const status = asIngestionStatus(paper.status);
    return status === 'pending' || status === 'processing';
  });

  useRefreshWhile(isSettling);

  return (
    <div className="grid-cards">
      {papers.map((paper) => (
        <PaperCard key={paper.id} paper={paper} />
      ))}
    </div>
  );
}

function PaperCard({ paper }: { paper: PaperView }) {
  const status = asIngestionStatus(paper.status);

  const [deleteState, deleteAction] = useActionState<ActionResult<undefined> | null, FormData>(
    deletePaperAction,
    null,
  );
  const [retryState, retryAction] = useActionState<ActionResult<undefined> | null, FormData>(
    retryPaperAction,
    null,
  );

  const actionError =
    (deleteState && !deleteState.ok && deleteState.message) ||
    (retryState && !retryState.ok && retryState.message) ||
    null;

  return (
    <article className="card card-tight" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 'var(--spacing-2)' }}>
        <span className={`pill ${PILL_TONE[status]}`}>
          {status === 'processing' ? <span className="spinner" aria-hidden="true" /> : null}
          {INGESTION_STATUS_LABELS[status]}
        </span>

        <a
          className="text-xs"
          href={`/api/papers/${paper.id}/file`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open original
        </a>
      </div>

      <h3 className="h3" style={{ marginBottom: 'var(--spacing-1)' }}>
        {paper.title}
      </h3>

      <p className="text-xs muted" style={{ margin: 0 }}>
        {[
          paper.authors,
          paper.year?.toString(),
          paper.pageCount ? `${paper.pageCount} pages` : null,
          formatFileSize(paper.sizeBytes),
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>

      {paper.statusMessage ? (
        <p
          className="text-sm"
          style={{
            marginTop: 'var(--spacing-3)',
            color: status === 'failed' ? 'var(--error)' : 'var(--text-secondary)',
          }}
        >
          {paper.statusMessage}
        </p>
      ) : null}

      {paper.plainSummary ? (
        <p className="text-sm" style={{ marginTop: 'var(--spacing-3)', marginBottom: 0 }}>
          {paper.plainSummary}
        </p>
      ) : null}

      {status === 'ready' ? (
        <details style={{ marginTop: 'var(--spacing-3)' }}>
          <summary className="text-sm" style={{ cursor: 'pointer', color: 'var(--accent-blue)' }}>
            Full analysis
          </summary>

          <div className="stack-sm" style={{ marginTop: 'var(--spacing-3)' }}>
            <AnalysisBlock label="Technical summary" value={paper.techSummary} />
            <AnalysisBlock label="Key findings" value={paper.keyFindings} />
            <AnalysisBlock label="Methodology" value={paper.methodology} />
            <AnalysisBlock label="Limitations" value={paper.limitations} />
            <p className="text-xs muted" style={{ margin: 0 }}>
              {paper.chunkCount} indexed passages · added {formatDate(paper.createdAt)}
            </p>
          </div>
        </details>
      ) : null}

      {actionError ? (
        <p className="field-error" role="alert">
          {actionError}
        </p>
      ) : null}

      <div className="row" style={{ marginTop: 'auto', paddingTop: 'var(--spacing-3)' }}>
        {status === 'failed' || status === 'pending' ? (
          <form action={retryAction}>
            <input type="hidden" name="paperId" value={paper.id} />
            <SubmitButton variant="secondary" size="sm" pendingLabel="Retrying…">
              Retry analysis
            </SubmitButton>
          </form>
        ) : null}

        {/*
          Re-running ingestion re-extracts a PDF that predates page tracking,
          so its passages — and future citations — gain page numbers.
        */}
        {status === 'ready' && !paper.hasPageNumbers ? (
          <form action={retryAction}>
            <input type="hidden" name="paperId" value={paper.id} />
            <SubmitButton
              variant="secondary"
              size="sm"
              pendingLabel="Re-processing…"
              title="Re-extract this PDF so citations can name the page they came from"
            >
              Add page numbers
            </SubmitButton>
          </form>
        ) : null}

        <form action={deleteAction}>
          <input type="hidden" name="paperId" value={paper.id} />
          <SubmitButton variant="ghost" size="sm" pendingLabel="Removing…">
            Remove
          </SubmitButton>
        </form>
      </div>
    </article>
  );
}

function AnalysisBlock({ label, value }: { label: string; value: string | null }) {
  if (!value) {
    return null;
  }

  return (
    <div>
      <span className="label" style={{ marginBottom: 'var(--spacing-1)' }}>
        {label}
      </span>
      <p className="text-sm" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
        {value}
      </p>
    </div>
  );
}
