import { describe, expect, it } from 'vitest';

import { renderMarkdown, type ExportCitation, type ExportInput } from '@/lib/export/markdown';

function paperCitation(overrides: Partial<ExportCitation> = {}): ExportCitation {
  return {
    ordinal: 1,
    quote: 'The threshold fell from 1.1 percent to 0.72 percent.',
    pageStart: 4,
    pageEnd: 4,
    source: {
      kind: 'paper',
      title: 'Surface Codes and Correlated Noise',
      authors: 'Fowler, A.',
      year: 2012,
    },
    ...overrides,
  };
}

function input(overrides: Partial<ExportInput> = {}): ExportInput {
  return {
    name: 'Thesis',
    documentType: 'Thesis',
    researchQuestion: null,
    exportedOn: 'Sep 14, 2026',
    sections: [],
    consultedSources: [],
    ...overrides,
  };
}

describe('renderMarkdown', () => {
  it('replaces markers with footnotes and defines them', () => {
    const output = renderMarkdown(
      input({
        sections: [
          { title: 'Results', content: 'The threshold drops [S1].', citations: [paperCitation()] },
        ],
      }),
    );

    expect(output).toContain('The threshold drops [^1].');
    expect(output).toContain(
      '[^1]: Fowler, A. (2012). *Surface Codes and Correlated Noise*, p. 4. "The threshold fell from 1.1 percent to 0.72 percent."',
    );
    expect(output).not.toContain('[S1]');
  });

  it('numbers footnotes globally in order of first appearance across sections', () => {
    const output = renderMarkdown(
      input({
        sections: [
          {
            title: 'Introduction',
            content: 'First [S2]. Second [S1].',
            citations: [paperCitation({ ordinal: 1 }), paperCitation({ ordinal: 2 })],
          },
          {
            title: 'Discussion',
            // Ordinals are local to a section, so this S1 is a new footnote.
            content: 'Third [S1].',
            citations: [paperCitation({ ordinal: 1 })],
          },
        ],
      }),
    );

    expect(output).toContain('First [^1]. Second [^2].');
    expect(output).toContain('Third [^3].');
  });

  it('reuses a footnote when the same source is cited again in a section', () => {
    const output = renderMarkdown(
      input({
        sections: [
          {
            title: 'Results',
            content: 'One [S1]. Two [S1, S2].',
            citations: [paperCitation({ ordinal: 1 }), paperCitation({ ordinal: 2 })],
          },
        ],
      }),
    );

    expect(output).toContain('One [^1]. Two [^1][^2].');
    expect(output.match(/^\[\^1\]:/gm)).toHaveLength(1);
  });

  it('flags a marker with no matching citation rather than inventing one', () => {
    const output = renderMarkdown(
      input({ sections: [{ title: 'Results', content: 'Claim [S9].', citations: [] }] }),
    );

    expect(output).toContain('Claim [citation needed].');
  });

  it('flags an unresolved marker', () => {
    const output = renderMarkdown(
      input({ sections: [{ title: 'Results', content: 'Claim [S?].', citations: [] }] }),
    );

    expect(output).toContain('Claim [citation needed].');
  });

  it('formats a page range and a note citation', () => {
    const output = renderMarkdown(
      input({
        sections: [
          {
            title: 'Discussion',
            content: 'A [S1]. B [S2].',
            citations: [
              paperCitation({ ordinal: 1, pageStart: 3, pageEnd: 5 }),
              { ordinal: 2, quote: 'My own observation.', pageStart: null, pageEnd: null, source: { kind: 'note' } },
            ],
          },
        ],
      }),
    );

    expect(output).toContain(', pp. 3–5.');
    expect(output).toContain('[^2]: Researcher\'s note. "My own observation."');
  });

  it('lists only cited papers under References, once each, sorted', () => {
    const zed = paperCitation({
      ordinal: 2,
      source: { kind: 'paper', title: 'Later Work', authors: 'Zed, Q.', year: 2020 },
    });

    const output = renderMarkdown(
      input({
        sections: [
          {
            title: 'Results',
            content: 'A [S2]. B [S1]. C [S1].',
            citations: [paperCitation({ ordinal: 1 }), zed],
          },
        ],
        consultedSources: [{ title: 'Never Cited', authors: null, year: null }],
      }),
    );

    // Bounded to the References block: footnote definitions follow it and
    // legitimately repeat the titles they cite.
    const start = output.indexOf('## References');
    const references = output.slice(start, output.indexOf('\n[^', start));
    expect(references.indexOf('Fowler')).toBeLessThan(references.indexOf('Zed'));
    expect(references.match(/Surface Codes and Correlated Noise/g)).toHaveLength(1);
    expect(output).not.toContain('Never Cited');
  });

  it('falls back to listing consulted sources when nothing is cited', () => {
    const output = renderMarkdown(
      input({
        sections: [{ title: 'Intro', content: 'Uncited prose.', citations: [] }],
        consultedSources: [{ title: 'A Source', authors: 'Lee, K.', year: 2019 }],
      }),
    );

    expect(output).toContain('## Sources consulted');
    expect(output).toContain('- Lee, K. (2019). *A Source*.');
  });

  it('marks an unwritten section and includes the research question', () => {
    const output = renderMarkdown(
      input({
        researchQuestion: 'Does noise correlation matter?',
        sections: [{ title: 'Conclusion', content: null, citations: [] }],
      }),
    );

    expect(output).toContain('> **Research question:** Does noise correlation matter?');
    expect(output).toContain('## Conclusion\n\n*This section has not been written yet.*');
  });
});
