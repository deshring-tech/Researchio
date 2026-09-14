import 'server-only';

import { AppError } from '@/lib/errors';
import { normalizeExtractedText } from '@/lib/text/chunk';
import { joinPages, type PageStart } from '@/lib/text/pages';

/**
 * MODULE: server/ingestion/extract
 *
 * Purpose
 *   Turn an uploaded file's bytes into normalized plain text, recording where
 *   each page begins so passages — and the citations built on them — can name
 *   a page.
 *
 * Responsibilities
 *   - Dispatch on MIME type to the right extractor.
 *   - Return text already normalized, with page offsets that refer to exactly
 *     that string.
 *   - Fail with an actionable message when a document yields no text.
 *
 * Public: `extractText`, `ExtractionResult`
 */

export interface ExtractionResult {
  /** Normalized text. `pageStarts` offsets refer to exactly this string. */
  text: string;
  pageCount: number | null;
  /** Where each page begins in `text`. Null for formats without pages. */
  pageStarts: PageStart[] | null;
}

/** Text that is almost certainly extraction failure rather than a short document. */
const MIN_USABLE_CHARS = 40;

async function extractPdf(bytes: Buffer): Promise<ExtractionResult> {
  // Imported lazily: pdf-parse pulls in pdfjs-dist, which is heavy and only
  // needed when a PDF is actually uploaded.
  const { PDFParse } = await import('pdf-parse');

  const parser = new PDFParse({ data: new Uint8Array(bytes) });

  try {
    const result = await parser.getText();
    const pageCount = result.total ?? null;

    // Per-page text is used rather than the concatenated `result.text`: the
    // page boundaries are what let a citation point at a page.
    if (result.pages.length > 0) {
      const { text, pageStarts } = joinPages(
        result.pages.map((page) => ({ page: page.num, text: page.text })),
      );
      return { text, pageCount, pageStarts };
    }

    return { text: normalizeExtractedText(result.text ?? ''), pageCount, pageStarts: null };
  } finally {
    // Releases the pdfjs worker. Skipping this leaks a worker per upload.
    await parser.destroy().catch(() => undefined);
  }
}

function extractPlainText(bytes: Buffer): ExtractionResult {
  return {
    text: normalizeExtractedText(bytes.toString('utf8')),
    pageCount: null,
    pageStarts: null,
  };
}

/**
 * Extracts text from an uploaded document.
 *
 * @throws AppError UNSUPPORTED_MEDIA for a type we cannot read.
 * @throws AppError VALIDATION when the file yields no usable text — most often
 *   a scanned PDF containing only page images, which needs OCR.
 */
export async function extractText(params: {
  bytes: Buffer;
  mimeType: string;
  originalName: string;
}): Promise<ExtractionResult> {
  const { bytes, mimeType, originalName } = params;
  const lowerName = originalName.toLowerCase();

  let result: ExtractionResult;

  if (mimeType === 'application/pdf' || lowerName.endsWith('.pdf')) {
    try {
      result = await extractPdf(bytes);
    } catch (error) {
      throw new AppError(
        'VALIDATION',
        `Could not read "${originalName}". The file may be corrupt or password protected.`,
        { cause: error },
      );
    }
  } else if (
    mimeType.startsWith('text/') ||
    lowerName.endsWith('.txt') ||
    lowerName.endsWith('.md')
  ) {
    result = extractPlainText(bytes);
  } else {
    throw new AppError(
      'UNSUPPORTED_MEDIA',
      `"${originalName}" is not a supported format. Upload a PDF, plain text, or Markdown file.`,
    );
  }

  if (result.text.length < MIN_USABLE_CHARS) {
    throw new AppError(
      'VALIDATION',
      `No readable text was found in "${originalName}". If this is a scanned document, it needs to be run through OCR first.`,
    );
  }

  return result;
}
