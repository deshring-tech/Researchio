import 'server-only';

import { AppError } from '@/lib/errors';
import { normalizeExtractedText } from '@/lib/text/chunk';

/**
 * MODULE: server/ingestion/extract
 *
 * Purpose
 *   Turn an uploaded file's bytes into plain text.
 *
 * Responsibilities
 *   - Dispatch on MIME type to the right extractor.
 *   - Normalize the result so downstream chunking sees consistent whitespace.
 *   - Fail with an actionable message when a document yields no text.
 *
 * Public: `extractText`, `ExtractionResult`
 */

export interface ExtractionResult {
  text: string;
  pageCount: number | null;
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
    return { text: result.text ?? '', pageCount: result.total ?? null };
  } finally {
    // Releases the pdfjs worker. Skipping this leaks a worker per upload.
    await parser.destroy().catch(() => undefined);
  }
}

function extractPlainText(bytes: Buffer): ExtractionResult {
  return { text: bytes.toString('utf8'), pageCount: null };
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

  const text = normalizeExtractedText(result.text);

  if (text.length < MIN_USABLE_CHARS) {
    throw new AppError(
      'VALIDATION',
      `No readable text was found in "${originalName}". If this is a scanned document, it needs to be run through OCR first.`,
    );
  }

  return { text, pageCount: result.pageCount };
}
