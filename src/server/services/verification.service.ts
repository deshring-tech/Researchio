import 'server-only';

import { createHash } from 'node:crypto';
import { z } from 'zod';

import { aiEnabled, generateJson } from '@/server/ai/provider';
import {
  CLAIM_CHECK_JSON_SCHEMA,
  CLAIM_CHECK_SYSTEM_INSTRUCTION,
  claimCheckPrompt,
} from '@/server/ai/prompts';
import { prisma } from '@/server/db/prisma';
import { logger } from '@/server/observability/logger';
import { RATE_LIMITS, consume } from '@/server/security/rate-limit';
import { assertSectionAccess } from '@/server/services/project.service';
import {
  CLAIM_VERDICTS,
  type ClaimCheckStatus,
  type ClaimCheckTarget,
  type ClaimReportView,
  type ClaimResult,
  type ClaimVerdict,
} from '@/lib/domain/claims';
import { isExpected } from '@/lib/errors';
import { claimProse, extractClaims } from '@/lib/text/claims';
import { formatPageRange } from '@/lib/text/pages';

/**
 * MODULE: server/services/verification
 *
 * Purpose
 *   Check each cited claim in a section against the passages it cites, and
 *   flag the ones its sources do not bear out.
 *
 * Why
 *   Grounded generation reduces fabrication but does not eliminate it. A model
 *   handed the right passage can still overstate a number, invert an effect, or
 *   attach a real citation to a claim the passage never makes. Checking each
 *   claim against its own evidence catches that before it reaches a thesis.
 *
 * Design
 *   - Deterministic first. A claim citing no known source, or a figure stated
 *     with no citation, is flagged without a model call.
 *   - Cached per claim. Each claim is keyed by its wording and the exact
 *     evidence it cites. Verdicts for unchanged claims are reused from the
 *     section's earlier reports, so re-checking after an edit sends only what
 *     changed — which is what makes automatic checks affordable.
 *   - Background. Checks run detached from the request, like ingestion, and
 *     record progress in `ClaimReport.status`; the document view polls.
 *   - Never overwrites newer work. A check records results only if its report
 *     still describes the text it checked.
 *
 * Public: `startClaimCheck`, `checkClaimsNow`, `requestClaimCheck`,
 *   `toClaimReportView`, `hashContent`
 */

/** Claims judged per model call. */
const BATCH_SIZE = 12;

/** Characters of each passage shown to the verifier. Chunks are capped below this. */
const PASSAGE_CHARS = 1_500;

/** A check running for longer than this without finishing is presumed dead. */
const STALL_MS = 5 * 60 * 1000;

/** Verdicts only a model can reach, and so the only ones worth caching. */
const MODEL_VERDICTS = ['supported', 'partial', 'unsupported', 'contradicted'] as const;

const modelResponseSchema = z.object({
  verdicts: z.array(
    z.object({
      claim: z.number().int(),
      verdict: z.enum(MODEL_VERDICTS),
      reason: z.string(),
    }),
  ),
});

const storedResultsSchema = z.array(
  z.object({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    ordinals: z.array(z.number().int()),
    verdict: z.enum(CLAIM_VERDICTS),
    reason: z.string().nullable(),
    key: z.string(),
  }),
);

interface Evidence {
  ordinal: number;
  label: string;
  text: string;
}

interface CheckInput {
  sectionId: string;
  target: ClaimCheckTarget;
  text: string;
  contentHash: string;
  evidence: Map<number, Evidence>;
  cache: Map<string, { verdict: ClaimVerdict; reason: string | null }>;
}

export interface ClaimCheckOutcome {
  claims: number;
  sentToModel: number;
  reused: number;
}

export function hashContent(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function parseResults(raw: string | null): ClaimResult[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = storedResultsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    // A corrupt report degrades to no verdicts rather than breaking the view.
    return [];
  }
}

/**
 * Keys a claim by its wording and the evidence behind it. Markers are excluded
 * and evidence is order-independent, so renumbering citations or regrouping
 * `[S2, S1]` as `[S1, S2]` does not force a re-check.
 */
function claimKey(prose: string, ordinals: readonly number[], evidence: Map<number, Evidence>): string {
  const evidenceHashes = [...ordinals]
    .sort((a, b) => a - b)
    .map((ordinal) => hashContent(evidence.get(ordinal)?.text ?? ''));

  return hashContent(JSON.stringify({ prose, evidence: evidenceHashes }));
}

async function loadInput(sectionId: string, target: ClaimCheckTarget): Promise<CheckInput | null> {
  const section = await prisma.section.findUnique({
    where: { id: sectionId },
    select: {
      userContent: true,
      aiContent: true,
      citations: {
        select: {
          ordinal: true,
          status: true,
          quote: true,
          pageStart: true,
          pageEnd: true,
          noteId: true,
          chunk: { select: { content: true } },
          paper: { select: { title: true } },
        },
      },
      claimReports: { select: { results: true } },
    },
  });

  if (!section) {
    return null;
  }

  // Offsets are computed against the stored text exactly as the view renders it.
  const text = (target === 'draft' ? section.aiContent : section.userContent) ?? '';

  const evidence = new Map<number, Evidence>();
  for (const citation of section.citations) {
    if (citation.ordinal === null) {
      continue;
    }
    // Accepted prose may only rest on accepted citations.
    if (target === 'document' && citation.status !== 'accepted') {
      continue;
    }

    // The live passage when it still exists; otherwise the snapshot taken when
    // it was cited, which survives re-indexing.
    const passage = citation.chunk?.content ?? citation.quote;
    if (!passage) {
      continue;
    }

    const pages = formatPageRange(citation.pageStart, citation.pageEnd);
    const origin = citation.paper
      ? citation.paper.title
      : citation.noteId
        ? "Researcher's own note"
        : 'Removed source';

    evidence.set(citation.ordinal, {
      ordinal: citation.ordinal,
      label: pages ? `${origin}, ${pages}` : origin,
      text: passage.slice(0, PASSAGE_CHARS),
    });
  }

  // Verdicts from both reports: a draft's verdicts carry over once accepted.
  const cache = new Map<string, { verdict: ClaimVerdict; reason: string | null }>();
  for (const report of section.claimReports) {
    for (const result of parseResults(report.results)) {
      if ((MODEL_VERDICTS as readonly string[]).includes(result.verdict)) {
        cache.set(result.key, { verdict: result.verdict, reason: result.reason });
      }
    }
  }

  return { sectionId, target, text, contentHash: hashContent(text), evidence, cache };
}

/** Marks a check as running for the current text, or clears it when there is no text. */
async function prepare(sectionId: string, target: ClaimCheckTarget): Promise<CheckInput | null> {
  const input = await loadInput(sectionId, target);
  if (!input) {
    return null;
  }

  if (input.text.length === 0) {
    await prisma.claimReport.deleteMany({ where: { sectionId, target } });
    return null;
  }

  await prisma.claimReport.upsert({
    where: { sectionId_target: { sectionId, target } },
    create: { sectionId, target, contentHash: input.contentHash, status: 'running' },
    update: { contentHash: input.contentHash, status: 'running', statusMessage: null },
  });

  return input;
}

/**
 * Stores results only if the report still describes the text that was
 * checked. If the text changed mid-check, a newer check owns the report and
 * this one's offsets would be wrong.
 */
async function record(
  input: CheckInput,
  status: ClaimCheckStatus,
  results: readonly ClaimResult[],
  statusMessage: string | null,
): Promise<void> {
  await prisma.claimReport.updateMany({
    where: { sectionId: input.sectionId, target: input.target, contentHash: input.contentHash },
    data: { status, statusMessage, results: JSON.stringify(results) },
  });
}

async function run(input: CheckInput): Promise<ClaimCheckOutcome> {
  const results: ClaimResult[] = [];
  const pending: Array<{ index: number; prose: string; ordinals: number[] }> = [];
  let reused = 0;
  let sentToModel = 0;

  for (const candidate of extractClaims(input.text)) {
    const prose = claimProse(candidate.text);
    const known = candidate.ordinals.filter((ordinal) => input.evidence.has(ordinal));
    const base = {
      start: candidate.start,
      end: candidate.end,
      ordinals: candidate.ordinals,
      key: claimKey(prose, known, input.evidence),
    };

    if (candidate.uncitedFigure) {
      results.push({ ...base, verdict: 'uncited_figure', reason: null });
      continue;
    }

    if (known.length === 0) {
      results.push({ ...base, verdict: 'unresolved', reason: null });
      continue;
    }

    const cached = input.cache.get(base.key);
    if (cached) {
      results.push({ ...base, ...cached });
      reused += 1;
      continue;
    }

    results.push({ ...base, verdict: 'unchecked', reason: null });
    pending.push({ index: results.length - 1, prose, ordinals: known });
  }

  try {
    let statusMessage: string | null = null;

    if (pending.length > 0 && !aiEnabled()) {
      statusMessage = 'AI is not configured, so cited claims were not checked against their sources.';
    } else {
      for (let offset = 0; offset < pending.length; offset += BATCH_SIZE) {
        const batch = pending.slice(offset, offset + BATCH_SIZE);
        const ordinals = [...new Set(batch.flatMap((item) => item.ordinals))].sort((a, b) => a - b);

        const response = await generateJson(
          claimCheckPrompt({
            claims: batch.map((item, position) => ({
              number: position + 1,
              text: item.prose,
              ordinals: item.ordinals,
            })),
            passages: ordinals.flatMap((ordinal) => {
              const passage = input.evidence.get(ordinal);
              return passage ? [passage] : [];
            }),
          }),
          CLAIM_CHECK_JSON_SCHEMA,
          modelResponseSchema,
          { systemInstruction: CLAIM_CHECK_SYSTEM_INSTRUCTION, temperature: 0 },
        );

        const byNumber = new Map(response.verdicts.map((verdict) => [verdict.claim, verdict]));

        batch.forEach((item, position) => {
          const verdict = byNumber.get(position + 1);
          // A claim the model skipped stays `unchecked` rather than being guessed.
          if (verdict) {
            results[item.index] = {
              ...results[item.index],
              verdict: verdict.verdict,
              reason: verdict.reason.trim() || null,
            };
          }
        });

        sentToModel += batch.length;
      }
    }

    await record(input, 'complete', results, statusMessage);
  } catch (error) {
    if (!isExpected(error)) {
      logger.error('Claim check failed', error, { sectionId: input.sectionId, target: input.target });
    }

    // Deterministic verdicts, cached ones and completed batches are still worth
    // showing alongside the failure.
    await record(
      input,
      'failed',
      results,
      isExpected(error) ? error.message : 'Claim checking failed unexpectedly. Try again.',
    );
  }

  return { claims: results.length, sentToModel, reused };
}

/**
 * Starts a claim check without blocking the caller.
 *
 * The report is marked running before this returns, so a page rendered
 * immediately afterwards shows the check in progress and polls for its result.
 * It never throws: the draft, accept or save that triggered it has already
 * succeeded and must not be reported as failing because checking could not
 * start.
 */
export async function startClaimCheck(sectionId: string, target: ClaimCheckTarget): Promise<void> {
  try {
    if (!consume(`verify-auto:${sectionId}`, RATE_LIMITS.verifyAutomatic).ok) {
      logger.warn('Skipped a claim check: section is being checked too often', { sectionId, target });
      return;
    }

    const input = await prepare(sectionId, target);
    if (!input) {
      return;
    }

    void run(input).catch((error: unknown) => {
      logger.error('Claim check crashed', error, { sectionId, target });
    });
  } catch (error) {
    logger.error('Could not start a claim check', error, { sectionId, target });
  }
}

/** Runs a claim check to completion. For scripts and verification. */
export async function checkClaimsNow(
  sectionId: string,
  target: ClaimCheckTarget,
): Promise<ClaimCheckOutcome | null> {
  const input = await prepare(sectionId, target);
  return input ? run(input) : null;
}

/** A user-requested check, after verifying they own the section. */
export async function requestClaimCheck(
  userId: string,
  sectionId: string,
  target: ClaimCheckTarget,
): Promise<string> {
  const projectId = await assertSectionAccess(sectionId, userId);
  await startClaimCheck(sectionId, target);
  return projectId;
}

/**
 * Prepares a stored report for display against the text as it stands now.
 *
 * @param currentText The exact stored text the view renders for this target.
 */
export function toClaimReportView(
  report: {
    status: string;
    contentHash: string;
    statusMessage: string | null;
    results: string | null;
    updatedAt: Date;
  },
  currentText: string,
): ClaimReportView {
  const status: ClaimCheckStatus =
    report.status === 'complete' || report.status === 'failed' ? report.status : 'running';

  return {
    status,
    fresh: report.contentHash === hashContent(currentText),
    stalled: status === 'running' && Date.now() - report.updatedAt.getTime() > STALL_MS,
    checkedAt: report.updatedAt.toISOString(),
    statusMessage: report.statusMessage,
    results: parseResults(report.results),
  };
}
