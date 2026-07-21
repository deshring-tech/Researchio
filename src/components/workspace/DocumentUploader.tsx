'use client';

import { useActionState, useEffect, useRef, useState } from 'react';

import { SubmitButton } from '@/components/ui/SubmitButton';
import { uploadPapersAction, type UploadOutcome } from '@/server/actions/paper.actions';
import { ACCEPTED_UPLOAD_EXTENSIONS } from '@/lib/domain/constants';
import { formatFileSize } from '@/lib/format';
import type { ActionResult } from '@/lib/errors';

/**
 * MODULE: components/workspace/DocumentUploader
 *
 * Purpose
 *   Upload source documents into a project.
 *
 * Behaviour
 *   Files genuinely reach the server, are stored, and enter the ingestion
 *   pipeline. The previous implementation ran a 1.5 second timer and showed a
 *   success alert without transmitting anything.
 *
 *   Only formats the pipeline can actually read are offered. Advertising
 *   support for .xlsx or .png while silently failing to extract text from them
 *   would repeat the same dishonesty in a subtler form.
 *
 *   Results are reported per file, so one unreadable PDF does not obscure the
 *   nine that succeeded.
 */
export function DocumentUploader({ projectId }: { projectId: string }) {
  const [state, formAction] = useActionState<ActionResult<UploadOutcome> | null, FormData>(
    uploadPapersAction,
    null,
  );

  const [selected, setSelected] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [handledResult, setHandledResult] = useState<typeof state>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  /**
   * Clear the pending selection once an upload succeeds.
   *
   * Adjusted during render rather than in an effect: React re-runs this
   * component immediately without painting the intermediate state, whereas a
   * `setState` inside `useEffect` would commit the stale list first and then
   * cascade a second render. Each submission returns a fresh result object, so
   * identity comparison reliably detects a new outcome.
   */
  if (state !== handledResult) {
    setHandledResult(state);
    if (state?.ok) {
      setSelected([]);
    }
  }

  // Clearing the native file input is a DOM mutation, which is what effects are
  // for; it cannot be expressed as derived state.
  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
    }
  }, [state]);

  /**
   * Mirrors a file list onto the hidden input.
   *
   * Dropped files are not automatically part of the form, so they are written
   * back through a DataTransfer. This keeps a single source of truth — the
   * input — for whatever the form submits.
   */
  function applyFiles(files: FileList | File[]) {
    const next = Array.from(files);
    const transfer = new DataTransfer();
    for (const file of next) {
      transfer.items.add(file);
    }

    if (inputRef.current) {
      inputRef.current.files = transfer.files;
    }

    setSelected(next);
  }

  return (
    <form ref={formRef} action={formAction} className="stack-sm">
      <input type="hidden" name="projectId" value={projectId} />

      <div
        className="dropzone"
        data-dragging={isDragging}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          if (event.dataTransfer.files.length > 0) {
            applyFiles(event.dataTransfer.files);
          }
        }}
      >
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => inputRef.current?.click()}
          style={{ color: 'var(--accent-blue)', fontWeight: 500 }}
        >
          Choose files
        </button>
        <span> or drag them here</span>
        <p className="text-xs muted" style={{ margin: 'var(--spacing-2) 0 0' }}>
          PDF, plain text or Markdown. Text is extracted, indexed and analysed.
        </p>

        <input
          ref={inputRef}
          id="paper-upload"
          name="files"
          type="file"
          multiple
          accept={ACCEPTED_UPLOAD_EXTENSIONS}
          className="sr-only"
          onChange={(event) => {
            if (event.target.files) {
              setSelected(Array.from(event.target.files));
            }
          }}
        />
      </div>

      {selected.length > 0 ? (
        <div className="stack-sm">
          {selected.map((file) => (
            <div
              key={`${file.name}-${file.size}`}
              className="row text-sm"
              style={{
                justifyContent: 'space-between',
                padding: 'var(--spacing-2)',
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-sm)',
                flexWrap: 'nowrap',
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {file.name}
              </span>
              <span className="muted text-xs">{formatFileSize(file.size)}</span>
            </div>
          ))}

          <SubmitButton block pendingLabel="Uploading…">
            {`Upload ${selected.length} file${selected.length > 1 ? 's' : ''}`}
          </SubmitButton>
        </div>
      ) : null}

      {state && !state.ok ? (
        <div className="banner banner-error" role="alert">
          {state.message}
        </div>
      ) : null}

      {state?.ok ? <UploadReport outcome={state.data} /> : null}
    </form>
  );
}

function UploadReport({ outcome }: { outcome: UploadOutcome }) {
  return (
    <div className="stack-sm">
      {outcome.accepted > 0 ? (
        <div className="banner banner-success" role="status">
          {`${outcome.accepted} file${outcome.accepted > 1 ? 's' : ''} uploaded. Analysis is running — status updates below.`}
        </div>
      ) : null}

      {outcome.failures.length > 0 ? (
        <div className="banner banner-error" role="alert">
          <div>
            <strong style={{ display: 'block' }}>Some files could not be uploaded</strong>
            <ul style={{ margin: 'var(--spacing-2) 0 0', paddingLeft: 'var(--spacing-4)' }}>
              {outcome.failures.map((failure) => (
                <li key={failure.name}>
                  {failure.name}: {failure.reason}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
