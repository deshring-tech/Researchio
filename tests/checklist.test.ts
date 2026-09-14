import { describe, expect, it } from 'vitest';

import { buildChecklist } from '@/server/services/document.service';

/** Convenience builder so each test states only what it is exercising. */
function section(overrides: Partial<Parameters<typeof buildChecklist>[0]['sections'][number]> = {}) {
  return {
    id: 'section-1',
    title: 'Introduction',
    userContent: null,
    status: 'incomplete',
    _citationCount: 0,
    ...overrides,
  };
}

const SUBSTANTIAL = 'x'.repeat(900);

describe('buildChecklist', () => {
  it('reports a project with no source documents', () => {
    const items = buildChecklist({ sections: [], paperCount: 0, noteCount: 0 });
    expect(items.some((item) => item.id === 'no-sources')).toBe(true);
  });

  it('treats missing sources as an error, since drafting cannot be grounded', () => {
    const items = buildChecklist({ sections: [], paperCount: 0, noteCount: 1 });
    expect(items.find((item) => item.id === 'no-sources')?.severity).toBe('error');
  });

  it('reports an empty section', () => {
    const items = buildChecklist({
      sections: [section({ id: 'a' })],
      paperCount: 1,
      noteCount: 1,
    });

    expect(items.some((item) => item.id === 'empty-a')).toBe(true);
  });

  it('treats whitespace-only content as empty', () => {
    const items = buildChecklist({
      sections: [section({ id: 'a', userContent: '   \n  ' })],
      paperCount: 1,
      noteCount: 1,
    });

    expect(items.some((item) => item.id === 'empty-a')).toBe(true);
  });

  it('flags a very short section as informational only', () => {
    const items = buildChecklist({
      sections: [section({ id: 'a', userContent: 'Just a stub.' })],
      paperCount: 1,
      noteCount: 1,
    });

    expect(items.find((item) => item.id === 'thin-a')?.severity).toBe('info');
  });

  it('flags a substantial section with no linked sources', () => {
    const items = buildChecklist({
      sections: [section({ id: 'a', userContent: SUBSTANTIAL, _citationCount: 0 })],
      paperCount: 1,
      noteCount: 1,
    });

    expect(items.some((item) => item.id === 'uncited-a')).toBe(true);
  });

  it('does not demand citations from a section that is only a stub', () => {
    // Nagging about provenance on two sentences would train users to ignore
    // the checklist entirely.
    const items = buildChecklist({
      sections: [section({ id: 'a', userContent: 'Short.' })],
      paperCount: 1,
      noteCount: 1,
    });

    expect(items.some((item) => item.id === 'uncited-a')).toBe(false);
  });

  it('says nothing about a complete, cited document', () => {
    const items = buildChecklist({
      sections: [
        section({ id: 'a', userContent: SUBSTANTIAL, status: 'approved', _citationCount: 3 }),
      ],
      paperCount: 2,
      noteCount: 1,
    });

    expect(items).toEqual([]);
  });

  it('sorts errors before warnings before info', () => {
    const items = buildChecklist({
      sections: [
        section({ id: 'a' }),
        section({ id: 'b', userContent: 'Short.' }),
      ],
      paperCount: 0,
      noteCount: 0,
    });

    const rank = { error: 0, warning: 1, info: 2 } as const;
    for (let index = 1; index < items.length; index += 1) {
      expect(rank[items[index].severity]).toBeGreaterThanOrEqual(rank[items[index - 1].severity]);
    }
  });

  it('links every section-specific item back to its section', () => {
    const items = buildChecklist({
      sections: [section({ id: 'abc' })],
      paperCount: 1,
      noteCount: 1,
    });

    const empty = items.find((item) => item.id === 'empty-abc');
    expect(empty?.sectionId).toBe('abc');
  });

  it('treats a citation that points at no source as an error', () => {
    // A fabricated citation in a thesis is worse than a missing one: it looks
    // supported when it is not.
    const items = buildChecklist({
      sections: [
        section({ id: 'a', userContent: SUBSTANTIAL, _citationCount: 2, _brokenCitationCount: 1 }),
      ],
      paperCount: 1,
      noteCount: 1,
    });

    expect(items.find((item) => item.id === 'broken-a')?.severity).toBe('error');
  });

  it('does not report broken citations when there are none', () => {
    const items = buildChecklist({
      sections: [section({ id: 'a', userContent: SUBSTANTIAL, _citationCount: 2 })],
      paperCount: 1,
      noteCount: 1,
    });

    expect(items.some((item) => item.id === 'broken-a')).toBe(false);
  });
});
