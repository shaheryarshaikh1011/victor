import * as fc from 'fast-check';
import { ConfigService } from '@nestjs/config';
import { EmbeddingService } from './embedding.service';
import { GeminiEmbeddingProvider } from './gemini-embedding.provider';
import { HashEmbeddingProvider } from './hash-embedding.provider';
import { EMBEDDING_DIMENSION } from './embedding.types';

/**
 * Feature: victor-v2-memory, Property: For any text, EmbeddingService returns a
 * null result on provider failure and never throws; identical normalized inputs
 * return cache-identical vectors.
 * Validates: Requirements 11.1
 */

/** Build a service with no embedding key configured (uses hash provider). */
function serviceWithHash(): EmbeddingService {
  const config = new ConfigService({});
  return new EmbeddingService(
    new GeminiEmbeddingProvider(config),
    new HashEmbeddingProvider(),
  );
}

/**
 * Build a service whose selected provider always fails. We configure a key so
 * the Gemini provider is selected, then force its `embed` to reject/return null
 * by pointing it at an environment where fetch throws.
 */
function serviceWithFailingProvider(): EmbeddingService {
  const config = new ConfigService({ GEMINI_API_KEY: 'test-key' });
  const gemini = new GeminiEmbeddingProvider(config);
  // Simulate a hard upstream failure: the provider throws inside embed.
  jest
    .spyOn(gemini, 'embed')
    .mockImplementation(async () => {
      throw new Error('simulated provider failure');
    });
  return new EmbeddingService(gemini, new HashEmbeddingProvider());
}

describe('EmbeddingService (Property: fallback and cache)', () => {
  it('returns null on provider failure and never throws', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async (text) => {
        const service = serviceWithFailingProvider();
        const result = await service.embed(text);
        expect(result).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it('returns cache-identical vectors for identical normalized inputs', async () => {
    const service = serviceWithHash();
    await fc.assert(
      fc.asyncProperty(fc.string(), async (text) => {
        const first = await service.embed(text);
        const second = await service.embed(text);
        expect(first).not.toBeNull();
        // Same object reference from the cache -> identical vectors.
        expect(second).toBe(first);
        expect(first).toHaveLength(EMBEDDING_DIMENSION);
      }),
      { numRuns: 100 },
    );
  });

  it('treats normalization-equivalent inputs as the same cache key', async () => {
    const service = serviceWithHash();
    await fc.assert(
      fc.asyncProperty(fc.string(), async (text) => {
        const base = await service.embed(text);
        // Extra surrounding whitespace and case changes normalize to the same key.
        const variant = await service.embed(`  ${text.toUpperCase()}  `);
        // Only assert equivalence when the normalized forms actually match.
        const normalize = (s: string) =>
          s.trim().toLowerCase().replace(/\s+/g, ' ');
        if (normalize(text) === normalize(`  ${text.toUpperCase()}  `)) {
          expect(variant).toBe(base);
        }
      }),
      { numRuns: 100 },
    );
  });
});
