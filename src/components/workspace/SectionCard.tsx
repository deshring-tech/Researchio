'use client';

import { useActionState, useState } from 'react';

import { ProseWithCitations } from '@/components/workspace/ProseWithCitations';
import { SubmitButton } from '@/components/ui/SubmitButton';
import {
  acceptDraftAction,
  deleteSectionAction,
  discardDraftAction,
  draftSectionAction,
  moveSectionAction,
  setSectionStatusAction,
  updateSectionAction,
} from '@/server/actions/document.actions';
import {
  SECTION_STATUS_LABELS,
  asSectionStatus,
  type SectionStatus,
} from '@/lib/domain/constants';
import { LIMITS } from '@/lib/validation/schemas';
import { wordCount } from '@/lib/format';
import type { ActionResult } from '@/lib/errors';

/**
 * MODULE: components/workspace/SectionCard
 *
 * Purpose
 *   One section of the living document: the researcher's prose, any pending AI
 *   proposal, and the controls that move between them.
 *
 * The accept/discard contract
 *   A generated draft is shown in a visually distinct block and is never merged
 *   into the researcher's text without an explicit accept. Accepting appends
 *   rather than overwrites, so no existing writing can be lost by a click.
 */

export interface SectionCitation {
  id: string;
  paperTitle: string | null;
}

export interface SectionView {
  id: string;
  title: string;
  position: number;
  userContent: string | null;
  aiContent: string | null;
  status: string;
  citations: SectionCitation[];
}

const STATUS_TONE: Record<SectionStatus, string> = {
  incomplete: 'pill-neutral',
  drafting: 'pill-ai',
  reviewing: 'pill-warning',
  approved: 'pill-success',
};

export function SectionCard({
  section,
  index,
  total,
  aiEnabled,
}: {
  section: SectionView;
  index: number;
  total: number;
  aiEnabled: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const status = asSectionStatus(section.status);

  const [draftState, draftAction] = useActionState<ActionResult<undefined> | null, FormData>(
    draftSectionAction,
    null,
  );
  const [saveState, saveAction] = useActionState<ActionResult<undefined> | null, FormData>(
    updateSectionAction,
    null,
  );

  const content = section.userContent?.trim() ?? '';

  return (
    <section className="card" id={`section-${section.id}`}>
      <div className="page-header" style={{ marginBottom: 'var(--spacing-3)' }}>
        <div>
          <h2 className="h2" style={{ marginBottom: 'var(--spacing-1)' }}>
            {index + 1}. {section.title}
          </h2>
          <div className="row">
            <span className={`pill ${STATUS_TONE[status]}`}>
              {SECTION_STATUS_LABELS[status]}
            </span>
            <span className="text-xs muted">{wordCount(content)} words</span>
            {section.citations.length > 0 ? (
              <span className="text-xs muted">
                · {section.citations.length} linked source
                {section.citations.length > 1 ? 's' : ''}
              </span>
            ) : null}
          </div>
        </div>

        <SectionToolbar
          sectionId={section.id}
          index={index}
          total={total}
          status={status}
        />
      </div>

      {/* The researcher's own prose. */}
      {isEditing ? (
        <form
          action={saveAction}
          onSubmit={() => setIsEditing(false)}
          className="stack-sm"
        >
          <input type="hidden" name="sectionId" value={section.id} />
          <label className="sr-only" htmlFor={`content-${section.id}`}>
            {section.title} content
          </label>
          <textarea
            id={`content-${section.id}`}
            name="userContent"
            className="input"
            rows={12}
            defaultValue={section.userContent ?? ''}
            maxLength={LIMITS.sectionContentMax}
            autoFocus
          />
          <div className="row">
            <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setIsEditing(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div>
          {content.length > 0 ? (
            <div className="document-content">
              <ProseWithCitations text={content} />
            </div>
          ) : (
            <p className="muted text-sm" style={{ fontStyle: 'italic' }}>
              Nothing written yet.
            </p>
          )}

          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ paddingLeft: 0 }}
            onClick={() => setIsEditing(true)}
          >
            {content.length > 0 ? 'Edit' : 'Write this section'}
          </button>
        </div>
      )}

      {saveState && !saveState.ok ? (
        <p className="field-error" role="alert">
          {saveState.message}
        </p>
      ) : null}

      {/* Pending AI proposal. */}
      {section.aiContent ? (
        <DraftProposal
          sectionId={section.id}
          draft={section.aiContent}
          citations={section.citations}
        />
      ) : null}

      {draftState && !draftState.ok ? (
        <div
          className="banner banner-warning"
          role="alert"
          style={{ marginTop: 'var(--spacing-3)' }}
        >
          {draftState.message}
        </div>
      ) : null}

      {!section.aiContent ? (
        <form action={draftAction} style={{ marginTop: 'var(--spacing-3)' }}>
          <input type="hidden" name="sectionId" value={section.id} />
          <SubmitButton
            variant="ai"
            size="sm"
            disabled={!aiEnabled}
            pendingLabel="Drafting from your sources…"
            title={
              aiEnabled
                ? 'Generate a grounded draft from your indexed sources'
                : 'Requires an AI key'
            }
          >
            {content.length > 0 ? 'Extend with AI' : 'Draft with AI'}
          </SubmitButton>
        </form>
      ) : null}
    </section>
  );
}

function DraftProposal({
  sectionId,
  draft,
  citations,
}: {
  sectionId: string;
  draft: string;
  citations: SectionCitation[];
}) {
  const [acceptState, accept] = useActionState<ActionResult<undefined> | null, FormData>(
    acceptDraftAction,
    null,
  );
  const [discardState, discard] = useActionState<ActionResult<undefined> | null, FormData>(
    discardDraftAction,
    null,
  );

  const error =
    (acceptState && !acceptState.ok && acceptState.message) ||
    (discardState && !discardState.ok && discardState.message) ||
    null;

  const sourceTitles = citations
    .map((citation) => citation.paperTitle)
    .filter((title): title is string => Boolean(title));

  return (
    <div className="ai-draft">
      <span className="ai-draft-label">AI proposal · not yet part of your document</span>

      <div className="document-content" style={{ fontSize: '1rem' }}>
        <ProseWithCitations text={draft} />
      </div>

      {sourceTitles.length > 0 ? (
        <div className="stack-sm" style={{ marginTop: 'var(--spacing-3)' }}>
          <span className="label" style={{ marginBottom: 0 }}>
            Grounded in
          </span>
          <div className="row">
            {[...new Set(sourceTitles)].map((title) => (
              <span key={title} className="pill pill-ai">
                {title}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="row" style={{ marginTop: 'var(--spacing-4)' }}>
        <form action={accept}>
          <input type="hidden" name="sectionId" value={sectionId} />
          <SubmitButton size="sm" pendingLabel="Adding…">
            Accept into document
          </SubmitButton>
        </form>

        <form action={discard}>
          <input type="hidden" name="sectionId" value={sectionId} />
          <SubmitButton variant="ghost" size="sm" pendingLabel="Discarding…">
            Discard
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}

function SectionToolbar({
  sectionId,
  index,
  total,
  status,
}: {
  sectionId: string;
  index: number;
  total: number;
  status: SectionStatus;
}) {
  const [, move] = useActionState<ActionResult<undefined> | null, FormData>(
    moveSectionAction,
    null,
  );
  const [, setStatus] = useActionState<ActionResult<undefined> | null, FormData>(
    setSectionStatusAction,
    null,
  );
  const [, remove] = useActionState<ActionResult<undefined> | null, FormData>(
    deleteSectionAction,
    null,
  );

  return (
    <div className="row" style={{ flexWrap: 'nowrap' }}>
      <form action={move}>
        <input type="hidden" name="sectionId" value={sectionId} />
        <input type="hidden" name="direction" value="up" />
        <SubmitButton variant="ghost" size="sm" disabled={index === 0} title="Move up">
          ↑
        </SubmitButton>
      </form>

      <form action={move}>
        <input type="hidden" name="sectionId" value={sectionId} />
        <input type="hidden" name="direction" value="down" />
        <SubmitButton
          variant="ghost"
          size="sm"
          disabled={index === total - 1}
          title="Move down"
        >
          ↓
        </SubmitButton>
      </form>

      {status !== 'approved' ? (
        <form action={setStatus}>
          <input type="hidden" name="sectionId" value={sectionId} />
          <input type="hidden" name="status" value="approved" />
          <SubmitButton variant="ghost" size="sm" title="Mark this section as finished">
            Approve
          </SubmitButton>
        </form>
      ) : null}

      <form action={remove}>
        <input type="hidden" name="sectionId" value={sectionId} />
        <SubmitButton variant="ghost" size="sm" title="Delete this section">
          ✕
        </SubmitButton>
      </form>
    </div>
  );
}
