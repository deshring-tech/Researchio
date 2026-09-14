import { parseCitations } from '@/lib/text/citations';
import { formatPageRange } from '@/lib/text/pages';

/**
 * MODULE: lib/export/markdown
 *
 * Purpose
 *   Render a living document as Markdown with real footnotes and a reference
 *   list, rather than leaving opaque `[S3]` markers in the output.
 *
 * Why footnotes
 *   `[^1]` footnotes are understood by Pandoc, GitHub and most Markdown
 *   editors, so the exported file converts to Word or LaTeX with its citations
 *   intact. Section-local ordinals are renumbered into one sequence across the
 *   whole document, in order of first appearance, as a reader expects.
 *
 * Purity
 *   Takes plain data and returns a string, so it is unit-testable without a
 *   database or a request.
 *
 * Public: `renderMarkdown`, `ExportInput`, `ExportSection`, `ExportCitation`
 */

export type ExportSource =
  | { kind: 'paper'; title: string; authors: string | null; year: number | null }
  | { kind: 'note' }
  | { kind: 'missing' };

export interface ExportCitation {
  ordinal: number;
  quote: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  source: ExportSource;
}

export interface ExportSection {
  title: string;
  content: string | null;
  /** Accepted citations for the section. Pending ones must not be passed. */
  citations: ExportCitation[];
}

export interface ExportInput {
  name: string;
  documentType: string;
  researchQuestion: string | null;
  exportedOn: string;
  sections: ExportSection[];
  /** Listed only when nothing is cited, so the reader still sees what was used. */
  consultedSources: Array<{ title: string; authors: string | null; year: number | null }>;
}

const QUOTE_LIMIT = 240;
const CITATION_NEEDED = '[citation needed]';

function shortenQuote(quote: string): string {
  const flat = quote.replace(/\s+/g, ' ').trim();
  if (flat.length <= QUOTE_LIMIT) {
    return flat;
  }

  const clipped = flat.slice(0, QUOTE_LIMIT);
  const lastSpace = clipped.lastIndexOf(' ');
  return `${lastSpace > QUOTE_LIMIT * 0.6 ? clipped.slice(0, lastSpace) : clipped}…`;
}

/** Author-date reference in a restrained APA-like form. */
function formatReference(source: { title: string; authors: string | null; year: number | null }) {
  const lead = [source.authors, source.year ? `(${source.year})` : null].filter(Boolean).join(' ');
  return lead ? `${lead}. *${source.title}*.` : `*${source.title}*.`;
}

function formatFootnote(citation: ExportCitation): string {
  const pages = formatPageRange(citation.pageStart, citation.pageEnd);
  const quote = citation.quote ? ` "${shortenQuote(citation.quote)}"` : '';

  switch (citation.source.kind) {
    case 'paper': {
      const reference = formatReference(citation.source).replace(/\.$/, '');
      return `${reference}${pages ? `, ${pages}` : ''}.${quote}`;
    }
    case 'note':
      return `Researcher's note.${quote}`;
    default:
      return `Source no longer available.${quote}`;
  }
}

export function renderMarkdown(input: ExportInput): string {
  const lines: string[] = [
    `# ${input.name}`,
    '',
    `*${input.documentType} — exported ${input.exportedOn}*`,
    '',
  ];

  if (input.researchQuestion) {
    lines.push(`> **Research question:** ${input.researchQuestion}`, '');
  }

  const footnotes: string[] = [];
  const cited = new Map<string, { title: string; authors: string | null; year: number | null }>();

  for (const section of input.sections) {
    lines.push(`## ${section.title}`, '');

    const content = section.content?.trim();
    if (!content) {
      lines.push('*This section has not been written yet.*', '');
      continue;
    }

    const byOrdinal = new Map(section.citations.map((citation) => [citation.ordinal, citation]));
    const footnoteFor = new Map<number, number>();

    const body = parseCitations(content)
      .map((segment) => {
        if (segment.type === 'text') {
          return segment.value;
        }

        const references = segment.ordinals.flatMap((ordinal) => {
          const citation = byOrdinal.get(ordinal);
          if (!citation) {
            return [];
          }

          let number = footnoteFor.get(ordinal);
          if (number === undefined) {
            number = footnotes.length + 1;
            footnoteFor.set(ordinal, number);
            footnotes.push(`[^${number}]: ${formatFootnote(citation)}`);

            if (citation.source.kind === 'paper') {
              const { title, authors, year } = citation.source;
              cited.set(`${title}|${authors ?? ''}|${year ?? ''}`, { title, authors, year });
            }
          }

          return [`[^${number}]`];
        });

        const unresolved = segment.unresolved || references.length < segment.ordinals.length;
        return `${references.join('')}${unresolved || references.length === 0 ? CITATION_NEEDED : ''}`;
      })
      .join('');

    lines.push(body, '');
  }

  if (cited.size > 0) {
    lines.push('## References', '');
    const references = [...cited.values()].sort((a, b) =>
      (a.authors ?? a.title).localeCompare(b.authors ?? b.title),
    );
    for (const reference of references) {
      lines.push(`- ${formatReference(reference)}`);
    }
    lines.push('');
  } else if (input.consultedSources.length > 0) {
    lines.push('## Sources consulted', '');
    for (const source of input.consultedSources) {
      lines.push(`- ${formatReference(source)}`);
    }
    lines.push('');
  }

  if (footnotes.length > 0) {
    lines.push(...footnotes, '');
  }

  return lines.join('\n');
}
