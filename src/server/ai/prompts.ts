import 'server-only';

import type { RetrievedChunk } from '@/server/services/retrieval.service';
import { formatPageRange } from '@/lib/text/pages';

/**
 * MODULE: server/ai/prompts
 *
 * Purpose
 *   Compose every prompt the application sends, in one reviewable place.
 *
 * Guiding principle
 *   These prompts govern text that will appear in someone's thesis. They are
 *   written to make the model refuse rather than invent: it is repeatedly
 *   instructed to ground claims in the supplied sources and to say plainly when
 *   the sources are insufficient. Fabricated citations are the single most
 *   damaging failure mode of a tool like this.
 *
 * Public: `ACADEMIC_SYSTEM_INSTRUCTION`, `buildSourceContext`,
 *   `paperAnalysisPrompt`, `chatPrompt`, `sectionDraftPrompt`,
 *   `declinedForLackOfMaterial`
 */

export const ACADEMIC_SYSTEM_INSTRUCTION = `You are a rigorous research assistant supporting a working academic.

Rules you must always follow:
- Ground every factual claim in the provided sources. Never invent findings, statistics, author names, or citations.
- When the sources do not answer the question, say so explicitly and state what evidence would be needed.
- Cite sources inline using the bracketed markers given to you, for example [S1]. For a claim resting on several sources, combine them in one marker, for example [S1, S3].
- Use only the marker numbers you were given. Never invent a marker for a source that was not supplied.
- Prefer precise, measured academic register. No marketing language, no hedging filler, no bullet-point padding.
- Never claim certainty the evidence does not support.`;

/** How a retrieved passage is labelled in prompts and rendered back in the UI. */
export function sourceLabel(index: number): string {
  return `S${index + 1}`;
}

/**
 * The reply requested when a section is being extended and nothing in the
 * sources adds to it. Declining is the honest outcome; padding the section with
 * a restatement of what it already says is not.
 */
const NO_NEW_MATERIAL = 'NO_NEW_MATERIAL';

/** True when the model declined to extend a section for lack of new material. */
export function declinedForLackOfMaterial(output: string): boolean {
  return new RegExp(`^\\W*${NO_NEW_MATERIAL}\\W*$`).test(output.trim());
}

/**
 * Renders retrieved passages as a numbered source block.
 *
 * Each passage is truncated so a handful of long chunks cannot crowd out the
 * instructions at the top of the prompt.
 */
export function buildSourceContext(chunks: readonly RetrievedChunk[], maxCharsPer = 1_500): string {
  if (chunks.length === 0) {
    return 'No sources are available for this project yet.';
  }

  return chunks
    .map((chunk, index) => {
      const pages = formatPageRange(chunk.pageStart, chunk.pageEnd);
      const origin =
        chunk.source.kind === 'paper'
          ? `Paper: ${chunk.source.title}${pages ? `, ${pages}` : ''}`
          : "Researcher's own note";

      const body =
        chunk.content.length > maxCharsPer
          ? `${chunk.content.slice(0, maxCharsPer)}…`
          : chunk.content;

      return `[${sourceLabel(index)}] (${origin})\n${body}`;
    })
    .join('\n\n');
}

// ---------------------------------------------------------------------------
// Paper analysis
// ---------------------------------------------------------------------------

/** JSON schema constraining the structured paper analysis response. */
export const PAPER_ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'The exact title of the paper.' },
    authors: {
      type: 'string',
      description: 'Comma-separated author names, or an empty string if not stated.',
    },
    year: {
      type: 'integer',
      description: 'Publication year, or 0 if not stated.',
    },
    plainSummary: {
      type: 'string',
      description: 'Two or three sentences a non-specialist would understand.',
    },
    techSummary: {
      type: 'string',
      description: 'Two or three sentences for a domain expert, preserving technical precision.',
    },
    keyFindings: {
      type: 'string',
      description: 'The main results, as a newline-separated list of short statements.',
    },
    methodology: {
      type: 'string',
      description: 'How the work was carried out, in two or three sentences.',
    },
    limitations: {
      type: 'string',
      description: 'Limitations the authors acknowledge, or that are evident. Two or three sentences.',
    },
  },
  required: [
    'title',
    'authors',
    'year',
    'plainSummary',
    'techSummary',
    'keyFindings',
    'methodology',
    'limitations',
  ],
} as const;

export function paperAnalysisPrompt(params: {
  fallbackTitle: string;
  text: string;
  maxChars?: number;
}): string {
  const budget = params.maxChars ?? 24_000;
  const excerpt =
    params.text.length > budget
      ? `${params.text.slice(0, budget)}\n\n[Document truncated for analysis.]`
      : params.text;

  return `Analyse the following research document and return the structured analysis.

If a field genuinely cannot be determined from the text, return an empty string for it (or 0 for the year). Do not guess at author names or publication years.

The filename was "${params.fallbackTitle}"; use it only if the document itself contains no title.

--- DOCUMENT ---
${excerpt}
--- END DOCUMENT ---`;
}

// ---------------------------------------------------------------------------
// Research assistant chat
// ---------------------------------------------------------------------------

export function chatPrompt(params: {
  projectName: string;
  researchQuestion: string | null;
  sources: readonly RetrievedChunk[];
  history: ReadonlyArray<{ role: string; content: string }>;
  question: string;
}): string {
  const history =
    params.history.length > 0
      ? params.history
          .map((turn) => `${turn.role === 'user' ? 'Researcher' : 'Assistant'}: ${turn.content}`)
          .join('\n\n')
      : 'No earlier messages.';

  return `You are assisting with the research project "${params.projectName}".
${params.researchQuestion ? `The central research question is: ${params.researchQuestion}` : ''}

--- SOURCES FROM THIS PROJECT ---
${buildSourceContext(params.sources)}
--- END SOURCES ---

--- RECENT CONVERSATION ---
${history}
--- END CONVERSATION ---

Researcher's question: ${params.question}

Answer using only the sources above, citing them inline as [S1], [S2] and so on. If the sources do not contain the answer, say so directly and suggest what the researcher could upload or record to close the gap. Do not pad the answer.`;
}

// ---------------------------------------------------------------------------
// Living document drafting
// ---------------------------------------------------------------------------

export function sectionDraftPrompt(params: {
  documentType: string;
  projectName: string;
  researchQuestion: string | null;
  sectionTitle: string;
  existingContent: string | null;
  outline: readonly string[];
  sources: readonly RetrievedChunk[];
}): string {
  const existing = params.existingContent?.trim();

  return `You are drafting the "${params.sectionTitle}" section of a ${params.documentType.toLowerCase()} titled "${params.projectName}".
${params.researchQuestion ? `Central research question: ${params.researchQuestion}` : ''}

The full document outline is: ${params.outline.join(' → ')}.
Write only the "${params.sectionTitle}" section. Do not write the other sections and do not repeat the section heading.

--- SOURCES FROM THIS PROJECT ---
${buildSourceContext(params.sources)}
--- END SOURCES ---

${
  existing
    ? `--- THE RESEARCHER'S EXISTING TEXT ---\n${existing}\n--- END EXISTING TEXT ---\n\nThis text stays exactly as it is, and your paragraphs will be appended after it. Write only NEW paragraphs that continue the section from where it ends. Do not repeat, restate, summarise or paraphrase anything already written. Keep the researcher's argument, voice and terminology, and do not contradict them.\n\nIf the sources contain nothing that adds to what is already written, reply with exactly ${NO_NEW_MATERIAL} and nothing else.`
    : 'The researcher has not drafted this section yet. Produce a first draft they can build on.'
}

Requirements:
- ${existing ? 'One to three' : 'Three to five'} paragraphs of continuous academic prose. No bullet lists, no headings.
- Every substantive claim must be supported by a source, cited inline as [S1], or [S1, S2] for several.
- Where the available sources are insufficient for this section, end with a single short paragraph beginning "Evidence gap:" naming precisely what is missing.${existing ? ' Do not repeat a gap the existing text already names.' : ''}
- Do not fabricate citations, results, or references to work not present in the sources.`;
}

// ---------------------------------------------------------------------------
// Claim verification
// ---------------------------------------------------------------------------

export const CLAIM_CHECK_SYSTEM_INSTRUCTION = `You are a meticulous fact-checker for academic writing. You judge whether each claim is supported by the specific source passages it cites, and by nothing else.

Rules you must always follow:
- Judge only against the passages supplied for that claim. Do not use outside knowledge, even when you believe the claim is true.
- "supported": every factual element of the claim — numbers, quantities, direction of an effect, scope, and causal or comparative language — is stated in or directly entailed by its passages.
- "partial": some elements are supported, but at least one (for example a number, a qualifier, or a causal link) is not found in the passages.
- "unsupported": the passages do not establish the claim.
- "contradicted": the passages state something incompatible with the claim.
- A claim that is vaguer than its passages but consistent with them is supported. A claim that is stronger, broader or more precise than its passages is not.
- Give each reason as one short sentence naming the specific element at issue, quoting numbers exactly.`;

/** JSON schema constraining the verifier's response. */
export const CLAIM_CHECK_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          claim: { type: 'integer', description: 'The number of the claim being judged.' },
          verdict: {
            type: 'string',
            enum: ['supported', 'partial', 'unsupported', 'contradicted'],
          },
          reason: {
            type: 'string',
            description: 'One short sentence naming the element at issue.',
          },
        },
        required: ['claim', 'verdict', 'reason'],
      },
    },
  },
  required: ['verdicts'],
};

export function claimCheckPrompt(params: {
  claims: ReadonlyArray<{ number: number; text: string; ordinals: readonly number[] }>;
  passages: ReadonlyArray<{ ordinal: number; label: string; text: string }>;
}): string {
  const passages = params.passages
    .map((passage) => `[S${passage.ordinal}] (${passage.label})\n${passage.text}`)
    .join('\n\n');

  const claims = params.claims
    .map(
      (claim) =>
        `Claim ${claim.number} (cites ${claim.ordinals.map((ordinal) => `S${ordinal}`).join(', ')}): ${claim.text}`,
    )
    .join('\n');

  return `Check each claim against the source passages it cites, and only those passages.

--- SOURCE PASSAGES ---
${passages}
--- END SOURCE PASSAGES ---

--- CLAIMS ---
${claims}
--- END CLAIMS ---

Return exactly one verdict for every claim number listed above.`;
}
