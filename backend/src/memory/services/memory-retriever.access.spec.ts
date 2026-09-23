import * as fc from 'fast-check';
import { EmbeddingService } from '../../embeddings/embedding.service';
import { MIN_MESSAGE_LEN_FOR_RETRIEVAL } from '../memory.constants';
import { MemoryRepository } from '../memory.repository';
import {
  InMemoryMemoryRepository,
  StubEmbeddingService,
} from '../memory.service.test-util';
import { CreateMemoryInput } from '../memory.types';
import { MemoryRetriever } from './memory-retriever.service';

const memoryTypeArb = fc.constantFrom(
  'explicit',
  'preference',
  'personal_fact',
  'episodic',
  'behavioral',
) as fc.Arbitrary<CreateMemoryInput['memoryType']>;

const contentArb = fc
  .string({ minLength: MIN_MESSAGE_LEN_FOR_RETRIEVAL, maxLength: 400 })
  .filter((s) => s.trim().length >= MIN_MESSAGE_LEN_FOR_RETRIEVAL);

const memoryArb: fc.Arbitrary<CreateMemoryInput> = fc.record({
  content: contentArb,
  memoryType: memoryTypeArb,
  source: fc.constant('auto_extracted') as fc.Arbitrary<
    CreateMemoryInput['source']
  >,
});

describe('MemoryRetriever (Property: last_accessed_at advances on retrieval)', () => {
  /**
   * Feature: victor-v2-memory, Property 8.3: For any retrieved memory, its
   * last_accessed_at is advanced to at or after the retrieval time.
   * Validates: Requirements 6.4
   */
  it('advances last_accessed_at to at or after the retrieval time for every match', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(memoryArb, { minLength: 1, maxLength: 15 }),
        contentArb,
        async (memories, rawQuery) => {
          const repo = new InMemoryMemoryRepository();
          const embeddings = new StubEmbeddingService();
          const retriever = new MemoryRetriever(
            repo.asRepository() as MemoryRepository,
            embeddings as unknown as EmbeddingService,
          );
          const userId = 'user-access';

          for (const input of memories) {
            const embedding = await embeddings.embed(input.content);
            await repo.insert(userId, {
              ...input,
              importance: 'medium',
              confidence: 0.6,
              embedding,
            });
          }

          const retrievalTime = Date.now();
          const matches = await retriever.getRelevant(userId, rawQuery);

          for (const match of matches) {
            const accessed = new Date(match.lastAccessedAt).getTime();
            // Advanced to at or after the retrieval time (Requirement 6.4).
            expect(accessed).toBeGreaterThanOrEqual(retrievalTime);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
