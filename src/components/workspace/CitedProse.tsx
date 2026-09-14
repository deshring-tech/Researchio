import { Fragment } from 'react';

import type { CitationView } from '@/lib/domain/citation';
import { citedOrdinals, parseCitations } from '@/lib/text/citations';
import { formatPageRange } from '@/lib/text/pages';

/**
 * MODULE: components/workspace/CitedProse
 *
 * Purpose
 *   Render prose with clickable source markers, and the numbered list of
 *   sources those markers point at.
 *
 * Design
 *   Footnote-style rather than popovers. Each marker is an in-page link to its
 *   entry in the source list beneath the prose, where the quoted passage, its
 *   page and a link to the original document live. This needs no JavaScript,
 *   works with keyboard and screen readers, prints sensibly, and mirrors how
 *   the document exports.
 *
 *   A marker that resolves to no source renders as a visible "?" rather than
 *   disappearing, so a fabricated citation is reviewed instead of disguised.
 *
 * Hook-free, so it renders in both Server and Client Components.
 *
 * Public: `CitedProse`, `CitationList`
 */

const PEEK_CHARS = 160;
const QUOTE_CHARS = 320;

function clip(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

function sourceName(citation: CitationView): string {
  switch (citation.source.kind) {
    case 'paper':
      return citation.source.title;
    case 'note':
      return 'Your note';
    default:
      return 'Removed source';
  }
}

/** One-line summary used for the marker's tooltip and accessible name. */
function describeCitation(citation: CitationView): string {
  const pages = formatPageRange(citation.pageStart, citation.pageEnd);
  const quote = citation.quote ? `: "${clip(citation.quote, PEEK_CHARS)}"` : '';
  return `${sourceName(citation)}${pages ? `, ${pages}` : ''}${quote}`;
}

function anchorId(prefix: string, ordinal: number): string {
  return `${prefix}-s${ordinal}`;
}

export function CitedProse({
  text,
  citations,
  anchorPrefix,
}: {
  text: string;
  citations: readonly CitationView[];
  /** Must be unique on the page; source list entries are anchored under it. */
  anchorPrefix: string;
}) {
  const byOrdinal = new Map(citations.map((citation) => [citation.ordinal, citation]));

  return (
    <>
      {parseCitations(text).map((segment, index) => {
        if (segment.type === 'text') {
          return <Fragment key={index}>{segment.value}</Fragment>;
        }

        const known = segment.ordinals.flatMap((ordinal) => {
          const citation = byOrdinal.get(ordinal);
          return citation ? [citation] : [];
        });
        const unresolved = segment.unresolved || known.length < segment.ordinals.length;

        return (
          <sup key={index} className="citation-group">
            {known.map((citation, position) => (
              <Fragment key={citation.ordinal}>
                {position > 0 ? ' ' : null}
                <a
                  className="citation-marker"
                  href={`#${anchorId(anchorPrefix, citation.ordinal)}`}
                  title={describeCitation(citation)}
                  aria-label={`Source ${citation.ordinal}: ${describeCitation(citation)}`}
                >
                  {citation.ordinal}
                </a>
              </Fragment>
            ))}
            {unresolved ? (
              <>
                {known.length > 0 ? ' ' : null}
                <span
                  className="citation-marker citation-unresolved"
                  title="This citation points to no source that was supplied. Check the claim before relying on it."
                >
                  <span aria-hidden="true">?</span>
                  <span className="sr-only">Unresolved citation</span>
                </span>
              </>
            ) : null}
          </sup>
        );
      })}
    </>
  );
}

export function CitationList({
  text,
  citations,
  anchorPrefix,
  heading = 'Sources',
}: {
  text: string;
  citations: readonly CitationView[];
  anchorPrefix: string;
  heading?: string;
}) {
  const byOrdinal = new Map(citations.map((citation) => [citation.ordinal, citation]));

  // Only sources the prose actually cites, in ordinal order.
  const used = citedOrdinals(text).flatMap((ordinal) => {
    const citation = byOrdinal.get(ordinal);
    return citation ? [citation] : [];
  });

  if (used.length === 0) {
    return null;
  }

  return (
    <div className="citation-list">
      <span className="label">{heading}</span>
      <ol>
        {used.map((citation) => {
          const pages = formatPageRange(citation.pageStart, citation.pageEnd);
          const meta =
            citation.source.kind === 'paper'
              ? [citation.source.authors, citation.source.year?.toString(), pages]
              : [pages];

          return (
            <li
              key={citation.ordinal}
              id={anchorId(anchorPrefix, citation.ordinal)}
              value={citation.ordinal}
            >
              <span className="citation-title">{sourceName(citation)}</span>
              {meta.some(Boolean) ? (
                <span className="citation-meta">{meta.filter(Boolean).join(' · ')}</span>
              ) : null}

              {citation.quote ? (
                <q className="citation-quote">{clip(citation.quote, QUOTE_CHARS)}</q>
              ) : null}

              {citation.source.kind === 'paper' ? (
                <a
                  className="citation-open"
                  // Browser PDF viewers honour `#page=N`; other files ignore it.
                  href={`/api/papers/${citation.source.id}/file${
                    citation.pageStart ? `#page=${citation.pageStart}` : ''
                  }`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {pages ? `Open at ${pages}` : 'Open source'}
                </a>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
