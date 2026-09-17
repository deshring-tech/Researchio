import 'server-only';

import { prisma } from '@/server/db/prisma';
import {
  ACADEMIC_SYSTEM_INSTRUCTION,
  declinedForLackOfMaterial,
  sectionDraftPrompt,
} from '@/server/ai/prompts';
import { generateText } from '@/server/ai/provider';
import { retrieve } from '@/server/services/retrieval.service';
import { assertProjectAccess, assertSectionAccess, touchProject } from '@/server/services/project.service';
import { recordEvent } from '@/server/services/timeline.service';
import { logger } from '@/server/observability/logger';
import type { SectionCitationView } from '@/lib/domain/citation';
import type { SectionStatus } from '@/lib/domain/constants';
import { AppError, notFound } from '@/lib/errors';
import { citedOrdinals, renumberCitations } from '@/lib/text/citations';
import { removeRestatedParagraphs } from '@/lib/text/overlap';

/**
 * MODULE: server/services/document
 *
 * Purpose
 *   The Living Document: section editing, grounded AI drafting, and the
 *   completion checklist.
 *
 * The drafting contract
 *   A draft is a *proposal*. It is written to `aiContent` and never merged into
 *   the researcher's `userContent` without an explicit accept. This keeps
 *   authorship unambiguous, which matters both academically and ethically —
 *   the tool must never quietly author someone's thesis.
 *
 * The provenance contract
 *   Every citation has an ordinal — the `n` in `[Sn]` — that is stable for the
 *   life of its section. A new draft reuses the ordinal of any passage already
 *   cited in accepted prose and numbers new passages after the highest one.
 *   Only `pending` citations, which belong to the unreviewed draft, are ever
 *   replaced or discarded.
 *
 *   The previous implementation deleted every citation on the section whenever
 *   it drafted or discarded, so extending a section silently stripped the
 *   provenance from prose that had already been accepted and repointed its
 *   markers at unrelated sources.
 *
 * Public: `draftSection`, `acceptDraft`, `discardDraft`, `updateSectionContent`,
 *   `setSectionStatus`, `addSection`, `deleteSection`, `moveSection`,
 *   `buildChecklist`, `toCitationView`
 */

/** Passages retrieved to ground one section draft. */
const DRAFT_SOURCE_LIMIT = 10;

/**
 * Characters of passage text snapshotted onto a citation.
 *
 * Generous on purpose: re-indexing a paper replaces its chunks and nulls the
 * citation's `chunkId`, after which the snapshot is the only record of the
 * evidence a claim rested on. Chunks are capped well below this, so in practice
 * the whole passage is kept.
 */
const QUOTE_SNAPSHOT_CHARS = 2_000;

const NOTHING_NEW_MESSAGE =
  'Your sources contain nothing that adds to what this section already says. Upload more material or add notes, then try again.';

async function loadSectionContext(sectionId: string) {
  const section = await prisma.section.findUnique({
    where: { id: sectionId },
    include: {
      document: {
        include: {
          project: { select: { id: true, name: true, researchQuestion: true } },
          sections: { orderBy: { position: 'asc' }, select: { title: true } },
        },
      },
    },
  });

  if (!section) {
    throw notFound('Section');
  }

  return section;
}

// ---------------------------------------------------------------------------
// Citations
// ---------------------------------------------------------------------------

/** A stored citation together with the relations the workspace views load. */
export interface CitationRow {
  ordinal: number | null;
  status: string;
  quote: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  noteId: string | null;
  paper: { id: string; title: string; authors: string | null; year: number | null } | null;
}

/**
 * Converts a stored citation for display.
 *
 * @returns null for a row with no ordinal, which no marker can reference.
 */
export function toCitationView(citation: CitationRow): SectionCitationView | null {
  if (citation.ordinal === null) {
    return null;
  }

  return {
    ordinal: citation.ordinal,
    status: citation.status === 'accepted' ? 'accepted' : 'pending',
    quote: citation.quote,
    pageStart: citation.pageStart,
    pageEnd: citation.pageEnd,
    source: citation.paper
      ? { kind: 'paper', ...citation.paper }
      : citation.noteId
        ? { kind: 'note', id: citation.noteId }
        : { kind: 'missing' },
  };
}

// ---------------------------------------------------------------------------
// Drafting
// ---------------------------------------------------------------------------

/**
 * Generates a grounded draft for a section.
 *
 * The retrieval query combines the section title with the researcher's existing
 * prose, so drafting an already-started section retrieves evidence relevant to
 * the argument they are actually making rather than to the heading alone.
 *
 * @throws AppError VALIDATION when the project has no evidence to draw on.
 *   Generating from nothing would produce exactly the ungrounded text this
 *   tool exists to avoid.
 */
export async function draftSection(userId: string, sectionId: string): Promise<string> {
  const projectId = await assertSectionAccess(sectionId, userId);
  const section = await loadSectionContext(sectionId);

  const query = [section.title, section.userContent ?? '']
    .filter(Boolean)
    .join('\n')
    .slice(0, 2_000);

  const sources = await retrieve(projectId, query, { limit: DRAFT_SOURCE_LIMIT });

  if (sources.length === 0) {
    throw new AppError(
      'VALIDATION',
      'There are no indexed sources relevant to this section yet. Upload a paper or add notes, then try again.',
    );
  }

  // Ordinals already backing accepted prose keep meaning the same passage.
  const accepted = await prisma.citationLink.findMany({
    where: { sectionId, status: 'accepted' },
    select: { chunkId: true, ordinal: true },
  });

  const acceptedOrdinalByChunk = new Map<string, number>();
  let nextOrdinal = 1;

  for (const citation of accepted) {
    if (citation.ordinal === null) {
      continue;
    }
    nextOrdinal = Math.max(nextOrdinal, citation.ordinal + 1);
    if (citation.chunkId) {
      acceptedOrdinalByChunk.set(citation.chunkId, citation.ordinal);
    }
  }

  // The model sees sources numbered S1..Sn in prompt order; this maps each to
  // the ordinal it carries within the section.
  const ordinals = sources.map((source) => {
    const existing = acceptedOrdinalByChunk.get(source.id);
    if (existing !== undefined) {
      return existing;
    }
    const assigned = nextOrdinal;
    nextOrdinal += 1;
    return assigned;
  });

  const generated = await generateText(
    sectionDraftPrompt({
      documentType: section.document.type,
      projectName: section.document.project.name,
      researchQuestion: section.document.project.researchQuestion,
      sectionTitle: section.title,
      existingContent: section.userContent,
      outline: section.document.sections.map((entry) => entry.title),
      sources,
    }),
    { systemInstruction: ACADEMIC_SYSTEM_INSTRUCTION, temperature: 0.35 },
  );

  // The model is told to decline when nothing in the sources adds to the
  // section, rather than padding it with a restatement.
  if (declinedForLackOfMaterial(generated)) {
    throw new AppError('VALIDATION', NOTHING_NEW_MESSAGE);
  }

  // A marker numbered beyond the supplied sources has no referent and becomes
  // `[S?]`, so the claim is flagged for review rather than looking supported.
  const renumbered = renumberCitations(generated, (local) => ordinals[local - 1] ?? null);

  // Accepting appends the draft to the researcher's prose, so a paragraph that
  // restates what is already there would duplicate it. Models asked to extend
  // a passage often rewrite it in full — in live testing an accepted extension
  // repeated the entire section — so restatements are removed regardless of
  // what the prompt asked for.
  const existingContent = section.userContent?.trim() ?? '';
  const { text: draft, removed } = existingContent
    ? removeRestatedParagraphs(renumbered, existingContent)
    : { text: renumbered.trim(), removed: 0 };

  if (removed > 0) {
    logger.info('Removed restated paragraphs from an extension draft', { sectionId, removed });
  }

  if (!draft) {
    throw new AppError('VALIDATION', NOTHING_NEW_MESSAGE);
  }

  const cited = new Set(citedOrdinals(draft));
  const reused = new Set(acceptedOrdinalByChunk.values());

  // Provenance is recorded only for passages the draft actually cites — a
  // retrieved passage the prose never uses is not evidence for it — and only
  // once: an ordinal that already backs accepted prose keeps its existing row.
  const newCitations = sources.flatMap((source, index) => {
    const ordinal = ordinals[index];
    if (!cited.has(ordinal) || reused.has(ordinal)) {
      return [];
    }

    return [
      {
        sectionId,
        chunkId: source.id,
        paperId: source.source.kind === 'paper' ? source.source.id : null,
        noteId: source.source.kind === 'note' ? source.source.id : null,
        ordinal,
        status: 'pending',
        quote: source.content.slice(0, QUOTE_SNAPSHOT_CHARS),
        pageStart: source.pageStart,
        pageEnd: source.pageEnd,
      },
    ];
  });

  await prisma.$transaction(async (tx) => {
    // Replaces only the previous unreviewed draft's citations.
    await tx.citationLink.deleteMany({ where: { sectionId, status: 'pending' } });

    await tx.section.update({
      where: { id: sectionId },
      data: { aiContent: draft, status: 'drafting', draftedAt: new Date() },
    });

    if (newCitations.length > 0) {
      await tx.citationLink.createMany({ data: newCitations });
    }
  });

  await recordEvent({
    projectId,
    type: 'SECTION_DRAFTED',
    description: `Drafted "${section.title}" citing ${cited.size} source${cited.size === 1 ? '' : 's'}`,
  });

  await touchProject(projectId);

  return draft;
}

/**
 * Merges the pending draft into the researcher's content and clears it.
 *
 * Appends rather than overwrites, so accepting a draft can never destroy
 * existing prose. The draft's citations become accepted in the same
 * transaction, so later drafting leaves them alone.
 */
export async function acceptDraft(userId: string, sectionId: string): Promise<string> {
  const projectId = await assertSectionAccess(sectionId, userId);

  const section = await prisma.section.findUnique({
    where: { id: sectionId },
    select: { title: true, userContent: true, aiContent: true },
  });

  if (!section?.aiContent) {
    throw new AppError('VALIDATION', 'There is no pending draft to accept.');
  }

  const merged = section.userContent?.trim()
    ? `${section.userContent.trim()}\n\n${section.aiContent.trim()}`
    : section.aiContent.trim();

  await prisma.$transaction([
    prisma.section.update({
      where: { id: sectionId },
      data: { userContent: merged, aiContent: null, status: 'reviewing' },
    }),
    prisma.citationLink.updateMany({
      where: { sectionId, status: 'pending' },
      data: { status: 'accepted' },
    }),
  ]);

  await recordEvent({
    projectId,
    type: 'SECTION_APPROVED',
    description: `Accepted the draft for "${section.title}"`,
  });

  await touchProject(projectId);
  return projectId;
}

/** Discards the pending draft and only the citations that belong to it. */
export async function discardDraft(userId: string, sectionId: string): Promise<string> {
  const projectId = await assertSectionAccess(sectionId, userId);

  const section = await prisma.section.findUnique({
    where: { id: sectionId },
    select: { userContent: true },
  });

  await prisma.$transaction([
    prisma.section.update({
      where: { id: sectionId },
      data: {
        aiContent: null,
        // Returning to `incomplete` would be wrong if the researcher has written
        // their own prose; only an empty section reverts.
        status: section?.userContent?.trim() ? 'reviewing' : 'incomplete',
      },
    }),
    prisma.citationLink.deleteMany({ where: { sectionId, status: 'pending' } }),
  ]);

  return projectId;
}

// ---------------------------------------------------------------------------
// Section editing
// ---------------------------------------------------------------------------

/**
 * Saves the researcher's prose.
 *
 * Accepted citations whose markers the researcher has deleted are pruned:
 * otherwise the section keeps reporting sources for claims it no longer makes.
 * Ordinals still referenced by a pending draft are kept, since that draft may
 * reuse them.
 */
export async function updateSectionContent(
  userId: string,
  input: { sectionId: string; userContent: string },
): Promise<string> {
  const projectId = await assertSectionAccess(input.sectionId, userId);
  const trimmed = input.userContent.trim();

  const section = await prisma.section.findUnique({
    where: { id: input.sectionId },
    select: { aiContent: true },
  });

  const stillCited = [
    ...new Set([...citedOrdinals(trimmed), ...citedOrdinals(section?.aiContent ?? '')]),
  ];

  await prisma.$transaction([
    prisma.section.update({
      where: { id: input.sectionId },
      data: {
        userContent: trimmed || null,
        status: trimmed ? 'reviewing' : 'incomplete',
      },
    }),
    prisma.citationLink.deleteMany({
      where: {
        sectionId: input.sectionId,
        status: 'accepted',
        ordinal: { notIn: stillCited },
      },
    }),
  ]);

  await touchProject(projectId);
  return projectId;
}

export async function setSectionStatus(
  userId: string,
  input: { sectionId: string; status: SectionStatus },
): Promise<string> {
  const projectId = await assertSectionAccess(input.sectionId, userId);

  const section = await prisma.section.update({
    where: { id: input.sectionId },
    data: { status: input.status },
    select: { title: true },
  });

  if (input.status === 'approved') {
    await recordEvent({
      projectId,
      type: 'SECTION_APPROVED',
      description: `Marked "${section.title}" as approved`,
    });
  }

  return projectId;
}

export async function addSection(
  userId: string,
  input: { projectId: string; title: string },
): Promise<string> {
  await assertProjectAccess(input.projectId, userId);

  const document = await prisma.livingDocument.findUnique({
    where: { projectId: input.projectId },
    select: { id: true, _count: { select: { sections: true } } },
  });

  if (!document) {
    throw notFound('Document');
  }

  await prisma.section.create({
    data: {
      documentId: document.id,
      title: input.title,
      position: document._count.sections,
    },
  });

  return input.projectId;
}

export async function deleteSection(userId: string, sectionId: string): Promise<string> {
  const projectId = await assertSectionAccess(sectionId, userId);
  await prisma.section.delete({ where: { id: sectionId } });
  return projectId;
}

/**
 * Moves a section one place up or down.
 *
 * Implemented as a positional swap inside a transaction. `position` carries no
 * unique constraint precisely so this needs no temporary placeholder value.
 */
export async function moveSection(
  userId: string,
  input: { sectionId: string; direction: 'up' | 'down' },
): Promise<string> {
  const projectId = await assertSectionAccess(input.sectionId, userId);

  const section = await prisma.section.findUnique({
    where: { id: input.sectionId },
    select: { id: true, documentId: true, position: true },
  });

  if (!section) {
    throw notFound('Section');
  }

  const neighbour = await prisma.section.findFirst({
    where: {
      documentId: section.documentId,
      position: input.direction === 'up' ? { lt: section.position } : { gt: section.position },
    },
    orderBy: { position: input.direction === 'up' ? 'desc' : 'asc' },
    select: { id: true, position: true },
  });

  // Already at the boundary; a no-op is the correct, unsurprising result.
  if (!neighbour) {
    return projectId;
  }

  await prisma.$transaction([
    prisma.section.update({ where: { id: section.id }, data: { position: neighbour.position } }),
    prisma.section.update({ where: { id: neighbour.id }, data: { position: section.position } }),
  ]);

  return projectId;
}

// ---------------------------------------------------------------------------
// Completion checklist
// ---------------------------------------------------------------------------

export type ChecklistSeverity = 'error' | 'warning' | 'info';

export interface ChecklistItem {
  id: string;
  severity: ChecklistSeverity;
  title: string;
  detail: string;
  sectionId?: string;
}

interface ChecklistInput {
  sections: ReadonlyArray<{
    id: string;
    title: string;
    userContent: string | null;
    status: string;
    /** Accepted sources actually cited by the prose. */
    _citationCount: number;
    /** Markers in the prose that resolve to no source. */
    _brokenCitationCount?: number;
    /** Claims a current check found partly supported, unsupported or contradicted. */
    _disputedClaimCount?: number;
  }>;
  paperCount: number;
  noteCount: number;
}

/** Sections shorter than this read as a stub rather than a draft. */
const THIN_SECTION_CHARS = 400;

/**
 * Derives the completion checklist from actual document state.
 *
 * Deliberately rule-based rather than AI-generated: these checks must be
 * deterministic, instant, and identical every time the page renders. An LLM
 * would make them slow, costly and inconsistent for no gain.
 */
export function buildChecklist(input: ChecklistInput): ChecklistItem[] {
  const items: ChecklistItem[] = [];

  if (input.paperCount === 0) {
    items.push({
      id: 'no-sources',
      severity: 'error',
      title: 'No source documents',
      detail:
        'Upload the papers underpinning this work. Until then, drafting has no evidence to ground itself in.',
    });
  }

  for (const section of input.sections) {
    const content = section.userContent?.trim() ?? '';

    if (content.length === 0) {
      items.push({
        id: `empty-${section.id}`,
        severity: 'warning',
        title: `"${section.title}" is empty`,
        detail: 'This section has no content yet.',
        sectionId: section.id,
      });
      continue;
    }

    const broken = section._brokenCitationCount ?? 0;
    if (broken > 0) {
      items.push({
        id: `broken-${section.id}`,
        severity: 'error',
        title: `"${section.title}" has citations that point to no source`,
        detail: `${broken} citation${broken === 1 ? '' : 's'} cannot be traced to a source. Check those claims before relying on them.`,
        sectionId: section.id,
      });
    }

    const disputed = section._disputedClaimCount ?? 0;
    if (disputed > 0) {
      items.push({
        id: `disputed-${section.id}`,
        severity: 'warning',
        title: `"${section.title}" has claims its sources do not support`,
        detail: `${disputed} claim${disputed === 1 ? ' goes' : 's go'} beyond or against the passage${disputed === 1 ? '' : 's'} cited. Review ${disputed === 1 ? 'it' : 'them'} before relying on this section.`,
        sectionId: section.id,
      });
    }

    if (content.length < THIN_SECTION_CHARS) {
      items.push({
        id: `thin-${section.id}`,
        severity: 'info',
        title: `"${section.title}" is very short`,
        detail: `Around ${content.split(/\s+/).length} words. Most sections of this kind need more development.`,
        sectionId: section.id,
      });
    }

    if (section._citationCount === 0 && content.length >= THIN_SECTION_CHARS) {
      items.push({
        id: `uncited-${section.id}`,
        severity: 'warning',
        title: `"${section.title}" has no linked sources`,
        detail:
          'This section is substantial but nothing links it to your source documents. Draft with AI to attach provenance, or verify the claims yourself.',
        sectionId: section.id,
      });
    }
  }

  if (input.noteCount === 0) {
    items.push({
      id: 'no-notes',
      severity: 'info',
      title: 'No research notes',
      detail:
        'Your own observations are indexed alongside papers and are often the strongest material for a discussion section.',
    });
  }

  const order: Record<ChecklistSeverity, number> = { error: 0, warning: 1, info: 2 };
  return items.sort((a, b) => order[a.severity] - order[b.severity]);
}
