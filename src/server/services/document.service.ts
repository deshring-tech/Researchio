import 'server-only';

import { prisma } from '@/server/db/prisma';
import { ACADEMIC_SYSTEM_INSTRUCTION, sectionDraftPrompt } from '@/server/ai/prompts';
import { generateText } from '@/server/ai/provider';
import { retrieve } from '@/server/services/retrieval.service';
import { assertProjectAccess, assertSectionAccess, touchProject } from '@/server/services/project.service';
import { recordEvent } from '@/server/services/timeline.service';
import { AppError, notFound } from '@/lib/errors';
import type { SectionStatus } from '@/lib/domain/constants';

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
 *   Every draft also writes `CitationLink` rows recording exactly which
 *   passages grounded it, so provenance survives after the prose is accepted.
 *
 * Public: `draftSection`, `acceptDraft`, `discardDraft`, `updateSectionContent`,
 *   `addSection`, `deleteSection`, `moveSection`, `buildChecklist`
 */

/** Passages retrieved to ground one section draft. */
const DRAFT_SOURCE_LIMIT = 10;

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

  const draft = await generateText(
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

  // Replace prior provenance for this section: the old citations belong to a
  // draft that no longer exists.
  await prisma.$transaction(async (tx) => {
    await tx.citationLink.deleteMany({ where: { sectionId } });

    await tx.section.update({
      where: { id: sectionId },
      data: { aiContent: draft, status: 'drafting', draftedAt: new Date() },
    });

    await tx.citationLink.createMany({
      data: sources.map((source) => ({
        sectionId,
        chunkId: source.id,
        paperId: source.source.kind === 'paper' ? source.source.id : null,
        noteId: source.source.kind === 'note' ? source.source.id : null,
        quote: source.content.slice(0, 500),
      })),
    });
  });

  await recordEvent({
    projectId,
    type: 'SECTION_DRAFTED',
    description: `Drafted "${section.title}" from ${sources.length} sources`,
  });

  await touchProject(projectId);

  return draft;
}

/**
 * Merges the pending draft into the researcher's content and clears it.
 *
 * Appends rather than overwrites, so accepting a draft can never destroy
 * existing prose.
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

  await prisma.section.update({
    where: { id: sectionId },
    data: { userContent: merged, aiContent: null, status: 'reviewing' },
  });

  await recordEvent({
    projectId,
    type: 'SECTION_APPROVED',
    description: `Accepted the draft for "${section.title}"`,
  });

  await touchProject(projectId);
  return projectId;
}

export async function discardDraft(userId: string, sectionId: string): Promise<string> {
  const projectId = await assertSectionAccess(sectionId, userId);

  const section = await prisma.section.findUnique({
    where: { id: sectionId },
    select: { userContent: true },
  });

  await prisma.section.update({
    where: { id: sectionId },
    data: {
      aiContent: null,
      // Returning to `incomplete` would be wrong if the researcher has written
      // their own prose; only an empty section reverts.
      status: section?.userContent?.trim() ? 'reviewing' : 'incomplete',
    },
  });

  await prisma.citationLink.deleteMany({ where: { sectionId } });

  return projectId;
}

// ---------------------------------------------------------------------------
// Section editing
// ---------------------------------------------------------------------------

export async function updateSectionContent(
  userId: string,
  input: { sectionId: string; userContent: string },
): Promise<string> {
  const projectId = await assertSectionAccess(input.sectionId, userId);
  const trimmed = input.userContent.trim();

  await prisma.section.update({
    where: { id: input.sectionId },
    data: {
      userContent: trimmed || null,
      status: trimmed ? 'reviewing' : 'incomplete',
    },
  });

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
    _citationCount: number;
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
