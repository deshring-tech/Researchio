import type { CitationStatus } from '@/lib/domain/constants';

/**
 * MODULE: lib/domain/citation
 *
 * Purpose
 *   The display shape of a citation, shared by the living document, the
 *   research assistant and export, so all three present provenance the same
 *   way.
 *
 * Dependencies: none at runtime. Safe on server and client.
 */

export type CitationSourceView =
  | { kind: 'paper'; id: string; title: string; authors: string | null; year: number | null }
  | { kind: 'note'; id: string }
  /** The source was deleted; the quote snapshot is all that remains. */
  | { kind: 'missing' };

export interface CitationView {
  /** The `n` in the `[Sn]` markers that reference this citation. */
  ordinal: number;
  quote: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  source: CitationSourceView;
}

export type SectionCitationView = CitationView & { status: CitationStatus };
