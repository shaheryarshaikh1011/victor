import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import {
  EMBEDDING_DIMENSION,
  EmbeddingProvider,
} from './embedding.types';

/**
 * HashEmbeddingProvider — a deterministic, dependency-free fallback used when
 * no embedding API key is configured, so the memory system still functions in
 * development and tests (Requirements 10.1, 11.1).
 *
 * It is not semantic: it hashes token n-grams into a fixed 768-dimension bag
 * and L2-normalizes the result. Identical text always yields an identical
 * vector, and cosine similarity still rewards lexical overlap, which is enough
 * for local/testing use.
 */
@Injectable()
export class HashEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'hash-embedding';
  readonly modelId = 'hash:v1';

  async embed(text: string): Promise<number[] | null> {
    return this.embedSync(text);
  }

  /** Synchronous core so tests can assert determinism without async plumbing. */
  embedSync(text: string): number[] {
    const vector = new Array<number>(EMBEDDING_DIMENSION).fill(0);
    const tokens = this.tokenize(text);

    for (const token of tokens) {
      const digest = createHash('sha256').update(token).digest();
      // Use pairs of bytes to derive an index and a signed weight so the
      // representation spreads across the full vector.
      const index =
        ((digest[0] << 8) | digest[1]) % EMBEDDING_DIMENSION;
      const sign = (digest[2] & 1) === 0 ? 1 : -1;
      const weight = (digest[3] + 1) / 256;
      vector[index] += sign * weight;
    }

    return this.normalize(vector);
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 0);
  }

  private normalize(vector: number[]): number[] {
    let sumSquares = 0;
    for (const v of vector) {
      sumSquares += v * v;
    }
    const magnitude = Math.sqrt(sumSquares);
    if (magnitude === 0) {
      return vector;
    }
    return vector.map((v) => v / magnitude);
  }
}
