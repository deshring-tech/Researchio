import { describe, expect, it } from 'vitest';

import { decodeEmbedding, encodeEmbedding, normalize, similarity } from '@/lib/vector';

describe('normalize', () => {
  it('scales a vector to unit length', () => {
    const [x, , z] = normalize([3, 0, 4, 0]);
    expect(x).toBeCloseTo(0.6, 6);
    expect(z).toBeCloseTo(0.8, 6);
  });

  it('leaves a zero vector untouched rather than dividing by zero', () => {
    expect(normalize([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it('does not mutate its input', () => {
    const input = [3, 4];
    normalize(input);
    expect(input).toEqual([3, 4]);
  });
});

describe('encodeEmbedding / decodeEmbedding', () => {
  it('uses four bytes per dimension', () => {
    expect(encodeEmbedding([1, 2, 3, 4]).byteLength).toBe(16);
  });

  it('round-trips a vector, normalized', () => {
    const decoded = decodeEmbedding(encodeEmbedding([3, 0, 4, 0]));

    expect(decoded.length).toBe(4);
    expect(decoded[0]).toBeCloseTo(0.6, 5);
    expect(decoded[2]).toBeCloseTo(0.8, 5);
  });

  it('decodes a view whose byteOffset is not four-byte aligned', () => {
    // Node pools small Buffers inside a larger ArrayBuffer, so a stored
    // embedding frequently arrives at an unaligned offset. Constructing a
    // Float32Array over it directly throws; decodeEmbedding must copy first.
    const encoded = encodeEmbedding([1, 0, 0, 0]);
    const pool = new Uint8Array(encoded.byteLength + 3);
    pool.set(encoded, 3);

    expect(() => decodeEmbedding(pool.subarray(3))).not.toThrow();
    expect(decodeEmbedding(pool.subarray(3)).length).toBe(4);
  });

  it('rejects a byte length that cannot be whole floats', () => {
    expect(() => decodeEmbedding(new Uint8Array(7))).toThrow(/multiple of 4/);
  });
});

describe('similarity', () => {
  const of = (values: number[]) => decodeEmbedding(encodeEmbedding(values));

  it('scores an identical vector at 1', () => {
    const vector = of([0.2, 0.5, 0.1, 0.9]);
    expect(similarity(vector, vector)).toBeCloseTo(1, 5);
  });

  it('scores orthogonal vectors at 0', () => {
    expect(similarity(of([1, 0, 0, 0]), of([0, 1, 0, 0]))).toBeCloseTo(0, 5);
  });

  it('scores opposite vectors at -1', () => {
    expect(similarity(of([1, 0]), of([-1, 0]))).toBeCloseTo(-1, 5);
  });

  it('ranks a closer vector above a further one', () => {
    const query = of([1, 0, 0]);
    expect(similarity(query, of([0.9, 0.1, 0]))).toBeGreaterThan(
      similarity(query, of([0.2, 0.9, 0])),
    );
  });

  it('returns 0 for mismatched dimensions instead of throwing', () => {
    // Changing embedding model mid-corpus must degrade retrieval, not break
    // the request.
    expect(similarity(of([1, 0, 0]), of([1, 0]))).toBe(0);
  });

  it('returns 0 for empty vectors', () => {
    expect(similarity(new Float32Array(0), new Float32Array(0))).toBe(0);
  });
});
