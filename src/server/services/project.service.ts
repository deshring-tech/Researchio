import 'server-only';

import { prisma } from '@/server/db/prisma';
import { recordEventWith } from '@/server/services/timeline.service';
import { DEFAULT_SECTIONS, type DocumentType } from '@/lib/domain/constants';
import { notFound } from '@/lib/errors';

/**
 * MODULE: server/services/project
 *
 * Purpose
 *   Project lifecycle, and the authorization boundary for everything inside a
 *   project.
 *
 * Responsibilities
 *   - Create a project together with its document scaffold in one transaction.
 *   - Enforce ownership. `assertProjectAccess` is the single chokepoint every
 *     other service calls before touching project-scoped data, so authorization
 *     cannot be forgotten in one handler and present in another.
 *
 * Public: `assertProjectAccess`, `listProjects`, `getProject`, `createProject`,
 *   `updateProject`, `deleteProject`
 */

export interface CreateProjectInput {
  name: string;
  documentType: DocumentType;
  researchQuestion?: string;
}

/**
 * Verifies the project exists and belongs to the user.
 *
 * A project owned by someone else reports NOT_FOUND rather than FORBIDDEN, so
 * the response cannot be used to probe which project IDs exist.
 *
 * @throws AppError NOT_FOUND
 */
export async function assertProjectAccess(projectId: string, userId: string): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { ownerId: true },
  });

  if (!project || project.ownerId !== userId) {
    throw notFound('Project');
  }
}

/** Same guard, for resources reached through a parent project. */
export async function assertSectionAccess(sectionId: string, userId: string): Promise<string> {
  const section = await prisma.section.findUnique({
    where: { id: sectionId },
    select: { document: { select: { projectId: true, project: { select: { ownerId: true } } } } },
  });

  if (!section || section.document.project.ownerId !== userId) {
    throw notFound('Section');
  }

  return section.document.projectId;
}

export async function listProjects(userId: string) {
  return prisma.project.findMany({
    where: { ownerId: userId },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      name: true,
      updatedAt: true,
      _count: { select: { papers: true, notes: true } },
    },
  });
}

/** Full project detail for the workspace views. */
export async function getProject(projectId: string, userId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      document: {
        include: {
          sections: {
            orderBy: { position: 'asc' },
            include: {
              citations: {
                include: {
                  paper: { select: { id: true, title: true } },
                  note: { select: { id: true } },
                },
              },
            },
          },
        },
      },
      notes: { orderBy: { createdAt: 'desc' } },
      papers: { orderBy: { createdAt: 'desc' } },
    },
  });

  if (!project) {
    throw notFound('Project');
  }

  if (project.ownerId !== userId) {
    throw notFound('Project');
  }

  return project;
}

export type ProjectDetail = Awaited<ReturnType<typeof getProject>>;

/**
 * Creates a project, its living document and the default section outline.
 *
 * Done in one transaction so a failure part-way cannot leave a project with no
 * document, which every document view would then have to defend against.
 */
export async function createProject(userId: string, input: CreateProjectInput) {
  const titles = DEFAULT_SECTIONS[input.documentType];

  return prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        ownerId: userId,
        name: input.name,
        researchQuestion: input.researchQuestion || null,
        document: {
          create: {
            type: input.documentType,
            sections: {
              create: titles.map((title, index) => ({ title, position: index })),
            },
          },
        },
      },
      select: { id: true, name: true },
    });

    await recordEventWith(tx, {
      projectId: project.id,
      type: 'PROJECT_CREATED',
      description: `Created ${input.documentType.toLowerCase()} project "${input.name}"`,
    });

    return project;
  });
}

export async function updateProject(
  projectId: string,
  userId: string,
  input: { name: string; researchQuestion?: string },
) {
  await assertProjectAccess(projectId, userId);

  return prisma.project.update({
    where: { id: projectId },
    data: {
      name: input.name,
      researchQuestion: input.researchQuestion || null,
    },
    select: { id: true, name: true },
  });
}

/**
 * Deletes a project and every child record via cascade.
 *
 * @returns Storage keys of the project's uploaded files, so the caller can
 *   remove them from disk. The service does not touch the filesystem itself —
 *   that keeps this module free of I/O concerns and testable.
 */
export async function deleteProject(projectId: string, userId: string): Promise<string[]> {
  await assertProjectAccess(projectId, userId);

  const papers = await prisma.paper.findMany({
    where: { projectId, storageKey: { not: null } },
    select: { storageKey: true },
  });

  await prisma.project.delete({ where: { id: projectId } });

  return papers
    .map((paper) => paper.storageKey)
    .filter((key): key is string => key !== null);
}

/** Bumps `updatedAt` so project ordering reflects real activity. */
export async function touchProject(projectId: string): Promise<void> {
  await prisma.project
    .update({ where: { id: projectId }, data: { updatedAt: new Date() } })
    .catch(() => undefined);
}
