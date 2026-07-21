/**
 * MODULE: lib/vector
 *
 * Purpose
 *   Encode, decode and compare embedding vectors.
 *
 * Storage format
 *   Vectors are persisted as raw little-endian Float32 in a `Bytes` column.
 *   A 768-dimension vector costs 3 KB this way versus roughly 15 KB as a JSON
 *   array of numbers, and decoding is a memory copy rather than a JSON parse.
 *
 * Normalization
 *   Vectors are L2-normalized before storage, which makes cosine similarity
 *   equal to the dot product. Retrieval therefore skips two square roots per
 *   comparison — meaningful when scoring thousands of chunks per query.
 *
 * Dependencies: none.
 */

const BYTES_PER_FLOAT = 4;

/**
 * Scales a vector to unit length. Returns a zero vector unchanged, since it has
 * no direction to preserve.
 */
export function normalize(values: readonly number[]): number[] {
  let sumOfSquares = 0;
  for (const value of values) {
    sumOfSquares += value * value;
  }

  if (sumOfSquares === 0) {
    return [...values];
  }

  const magnitude = Math.sqrt(sumOfSquares);
  return values.map((value) => value / magnitude);
}

/**
 * Serializes a vector for the database. Input is normalized first.
 *
 * Returns a plain `Uint8Array` rather than a Node `Buffer`: Prisma's `Bytes`
 * type requires a view backed by a concrete `ArrayBuffer`, while `Buffer` is
 * typed over `ArrayBufferLike` because it may be pooled. The buffer type is
 * spelled out explicitly because TypeScript 5.7 made typed arrays generic over
 * it, and the bare `Uint8Array` alias widens to `ArrayBufferLike`.
 */
export function encodeEmbedding(values: readonly number[]): Uint8Array<ArrayBuffer> {
  const floats = Float32Array.from(normalize(values));

  const bytes = new Uint8Array(floats.byteLength);
  bytes.set(new Uint8Array(floats.buffer, floats.byteOffset, floats.byteLength));
  return bytes;
}

/**
 * Deserializes a stored vector.
 *
 * The bytes are copied into a fresh buffer rather than viewed in place: Node
 * pools small Buffers inside a larger ArrayBuffer, so `byteOffset` is often not
 * a multiple of 4, and constructing a Float32Array over an unaligned offset
 * throws.
 */
export function decodeEmbedding(bytes: Uint8Array): Float32Array {
  if (bytes.byteLength % BYTES_PER_FLOAT !== 0) {
    throw new Error(
      `Corrupt embedding: ${bytes.byteLength} bytes is not a multiple of ${BYTES_PER_FLOAT}.`,
    );
  }

  const aligned = new Uint8Array(bytes.byteLength);
  aligned.set(bytes);
  return new Float32Array(aligned.buffer);
}

/**
 * Similarity between two stored (already normalized) vectors.
 *
 * Equivalent to cosine similarity given unit-length inputs. Mismatched
 * dimensions score 0 rather than throwing, so a model change mid-corpus
 * degrades retrieval instead of breaking the request.
 */
export function similarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }

  let dotProduct = 0;
  for (let index = 0; index < a.length; index += 1) {
    dotProduct += a[index] * b[index];
  }

  return dotProduct;
}
