import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { EMBED_CACHE_SIZE } from '../memory/memory.constants';
import { EmbeddingProvider } from './embedding.types';
import { GeminiEmbeddingProvider } from './gemini-embedding.provider';
import { HashEmbeddingProvider } from './hash-embedding.provider';

/**
 * EmbeddingService — the single entry point for producing embeddings
 * (Requirement 10.1).
 *
 * Provider selection: the Gemini provider is used when `GEMINI_API_KEY` is
 * configured; otherwise the deterministic hash provider is used so the system
 * still functions in dev/tests. On any provider failure `embed` returns `null`
 * and never throws, so the memory pipeline degrades gracefully
 * (Requirement 11.1).
 *
 * A bounded LRU cache keyed by the SHA-256 of the normalized text collapses
 * repeated/identical queries to zero provider calls (Requirement 12.2).
 */
@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly provider: EmbeddingProvider;
  /** Insertion-ordered LRU: re-inserting on hit moves a key to the end. */
  private readonly cache = new Map<string, number[]>();

  constructor(
    private readonly gemini: GeminiEmbeddingProvider,
    private readonly hash: HashEmbeddingProvider,
  ) {
    this.provider = this.gemini.isConfigured() ? this.gemini : this.hash;
    this.logger.log(`Embedding provider selected: ${this.provider.name}`);
  }

  /** The vector space of every embedding this service returns. */
  get modelId(): string {
    return this.provider.modelId;
  }

  /**
   * Return an embedding for `text`, or `null` on failure. Identical normalized
   * inputs return cache-identical vectors.
   */
  async embed(text: string): Promise<number[] | null> {
    const key = this.cacheKey(text);

    const cached = this.cache.get(key);
    if (cached) {
      // Refresh recency for LRU eviction.
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }

    let vector: number[] | null;
    try {
      vector = await this.provider.embed(text);
    } catch (err) {
      // Providers should not throw, but guarantee resilience regardless.
      this.logger.warn(`Embedding provider threw: ${(err as Error).message}`);
      return null;
    }

    if (vector) {
      this.putCache(key, vector);
    }
    return vector;
  }

  private putCache(key: string, vector: number[]): void {
    this.cache.set(key, vector);
    if (this.cache.size > EMBED_CACHE_SIZE) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }
  }

  private cacheKey(text: string): string {
    const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
    return createHash('sha256').update(normalized).digest('hex');
  }
}
