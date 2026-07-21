/**
 * MODULE: lib/domain/constants
 *
 * Purpose
 *   Single source of truth for the string-union columns in the Prisma schema.
 *
 * Why
 *   SQLite does not support Prisma `enum`, so these columns are `String`. These
 *   constants and their derived types provide the compile-time safety the
 *   database cannot enforce, and give the UI a canonical list to render.
 *
 * Dependencies: none. Safe to import from both server and client code.
 */

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export const DOCUMENT_TYPES = [
  'Thesis',
  'Dissertation',
  'Journal Paper',
  'Research Proposal',
  'Grant Proposal',
  'Technical Report',
  'Literature Review',
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/**
 * Default section scaffolding per document type. Creating a project
 * immediately yields a navigable outline rather than an empty page.
 */
export const DEFAULT_SECTIONS: Record<DocumentType, readonly string[]> = {
  Thesis: [
    'Abstract',
    'Introduction',
    'Literature Review',
    'Methodology',
    'Results',
    'Discussion',
    'Conclusion',
  ],
  Dissertation: [
    'Abstract',
    'Introduction',
    'Literature Review',
    'Theoretical Framework',
    'Methodology',
    'Results',
    'Discussion',
    'Conclusion',
  ],
  'Journal Paper': [
    'Abstract',
    'Introduction',
    'Related Work',
    'Methods',
    'Results',
    'Discussion',
    'Conclusion',
  ],
  'Research Proposal': [
    'Background',
    'Problem Statement',
    'Research Questions',
    'Proposed Methodology',
    'Expected Contributions',
    'Timeline',
  ],
  'Grant Proposal': [
    'Executive Summary',
    'Background and Significance',
    'Specific Aims',
    'Research Design',
    'Budget Justification',
    'Broader Impacts',
  ],
  'Technical Report': [
    'Executive Summary',
    'Introduction',
    'System Design',
    'Evaluation',
    'Findings',
    'Recommendations',
  ],
  'Literature Review': [
    'Introduction',
    'Search Strategy',
    'Thematic Synthesis',
    'Critical Appraisal',
    'Research Gaps',
    'Conclusion',
  ],
};

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export const SECTION_STATUSES = ['incomplete', 'drafting', 'reviewing', 'approved'] as const;
export type SectionStatus = (typeof SECTION_STATUSES)[number];

export const SECTION_STATUS_LABELS: Record<SectionStatus, string> = {
  incomplete: 'Not started',
  drafting: 'Draft pending review',
  reviewing: 'In review',
  approved: 'Approved',
};

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

export const INGESTION_STATUSES = ['pending', 'processing', 'ready', 'failed'] as const;
export type IngestionStatus = (typeof INGESTION_STATUSES)[number];

export const INGESTION_STATUS_LABELS: Record<IngestionStatus, string> = {
  pending: 'Queued',
  processing: 'Analysing',
  ready: 'Ready',
  failed: 'Failed',
};

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export const CHAT_ROLES = ['user', 'assistant'] as const;
export type ChatRole = (typeof CHAT_ROLES)[number];

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export const TIMELINE_EVENT_TYPES = [
  'PROJECT_CREATED',
  'NOTE_ADDED',
  'NOTE_DELETED',
  'PAPER_UPLOADED',
  'PAPER_READY',
  'PAPER_FAILED',
  'PAPER_DELETED',
  'SECTION_DRAFTED',
  'SECTION_APPROVED',
  'SECTION_EDITED',
] as const;

export type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[number];

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------

/**
 * Accepted upload types. Only formats the ingestion pipeline can actually read
 * are listed — offering a type we cannot parse would be a false promise.
 */
export const ACCEPTED_UPLOAD_TYPES: Record<string, { extension: string; label: string }> = {
  'application/pdf': { extension: '.pdf', label: 'PDF' },
  'text/plain': { extension: '.txt', label: 'Text' },
  'text/markdown': { extension: '.md', label: 'Markdown' },
};

export const ACCEPTED_UPLOAD_EXTENSIONS = Object.values(ACCEPTED_UPLOAD_TYPES)
  .map((type) => type.extension)
  .join(',');

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

function makeGuard<T extends string>(values: readonly T[]) {
  const set: ReadonlySet<string> = new Set(values);
  return (value: string): value is T => set.has(value);
}

const isSectionStatus = makeGuard(SECTION_STATUSES);
const isIngestionStatus = makeGuard(INGESTION_STATUSES);

/**
 * Narrows a database string to a known status, falling back to a safe default
 * so a stray value can never crash a render.
 */
export function asIngestionStatus(value: string): IngestionStatus {
  return isIngestionStatus(value) ? value : 'pending';
}

export function asSectionStatus(value: string): SectionStatus {
  return isSectionStatus(value) ? value : 'incomplete';
}
