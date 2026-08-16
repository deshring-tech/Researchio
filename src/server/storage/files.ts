import 'server-only';

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { env } from '@/server/config/env';
import { logger } from '@/server/observability/logger';
import { ACCEPTED_UPLOAD_TYPES } from '@/lib/domain/constants';
import { AppError } from '@/lib/errors';

/**
 * MODULE: server/storage/files
 *
 * Purpose
 *   Persist and retrieve uploaded source documents on the local filesystem.
 *
 * Security
 *   Storage keys are server-generated (`<uuid><ext>`) and never derived from
 *   user input, so an uploaded filename cannot influence the path written to.
 *   Reads additionally re-validate the key shape and confirm the resolved path
 *   is inside the upload directory, which defeats traversal even if a malformed
 *   key reaches the database.
 *
 * Future extension points
 *   Swapping to object storage (S3, R2) means reimplementing these four
 *   functions; nothing else in the codebase touches the filesystem.
 */

/** `<uuid>.<ext>` — the only shape this module ever produces or accepts. */
const STORAGE_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$/;

export interface StoredFile {
  storageKey: string;
  sizeBytes: number;
}

function extensionFor(mimeType: string, originalName: string): string {
  const known = ACCEPTED_UPLOAD_TYPES[mimeType];
  if (known) {
    return known.extension;
  }

  // Fall back to the declared extension, sanitised. Some browsers send
  // `application/octet-stream` for .md files.
  const raw = path.extname(originalName).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(raw) ? raw : '.bin';
}

async function ensureDirectory(): Promise<void> {
  await mkdir(env.uploads.directory, { recursive: true });
}

/**
 * Resolves a storage key to an absolute path, rejecting anything that escapes
 * the upload directory.
 */
function resolveKey(storageKey: string): string {
  if (!STORAGE_KEY_PATTERN.test(storageKey)) {
    throw new AppError('VALIDATION', 'Invalid file reference.');
  }

  const absolute = path.resolve(env.uploads.directory, storageKey);
  const root = path.resolve(env.uploads.directory);

  if (absolute !== path.join(root, storageKey)) {
    throw new AppError('VALIDATION', 'Invalid file reference.');
  }

  return absolute;
}

/**
 * Writes an uploaded file to disk under a generated key.
 *
 * @throws AppError PAYLOAD_TOO_LARGE when the file exceeds the configured cap.
 */
export async function saveUpload(file: File): Promise<StoredFile> {
  if (file.size > env.uploads.maxBytes) {
    throw new AppError(
      'PAYLOAD_TOO_LARGE',
      `"${file.name}" is larger than the ${env.uploads.maxMegabytes} MB limit.`,
    );
  }

  if (file.size === 0) {
    throw new AppError('VALIDATION', `"${file.name}" is empty.`);
  }

  await ensureDirectory();

  const storageKey = `${randomUUID()}${extensionFor(file.type, file.name)}`;
  const bytes = Buffer.from(await file.arrayBuffer());

  await writeFile(resolveKey(storageKey), bytes);

  return { storageKey, sizeBytes: bytes.byteLength };
}

export async function readUpload(storageKey: string): Promise<Buffer> {
  try {
    return await readFile(resolveKey(storageKey));
  } catch (error) {
    throw new AppError('NOT_FOUND', 'The stored file is no longer available.', { cause: error });
  }
}

/**
 * Deletes a stored file.
 *
 * Missing files are ignored: the database row is the source of truth, and a
 * failed cleanup must not block deleting the record the user asked to remove.
 */
export async function deleteUpload(storageKey: string): Promise<void> {
  try {
    await unlink(resolveKey(storageKey));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      logger.warn('Failed to remove stored file', { storageKey, error });
    }
  }
}

/** Best-effort bulk cleanup, used when a project is deleted. */
export async function deleteUploads(storageKeys: readonly string[]): Promise<void> {
  await Promise.all(storageKeys.map((key) => deleteUpload(key)));
}
