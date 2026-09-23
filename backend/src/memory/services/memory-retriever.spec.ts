import * as fc from 'fast-check';
import { EmbeddingService } from '../../embeddings/embedding.service';
import {
  MAX_CONTEXT_CHARS,
  MAX_CONTEXT_MEMORIES,
  MIN_MESSAGE_LEN_FOR_RETRIEVAL,
  MIN_SIMILARITY,
} from '../memory.constants';
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

const sourceArb = fc.constantFrom(
  'user_explicit',
  'auto_extracted',
) as fc.Arbitrary<CreateMemoryInput['source']>;

/** Content long enough to clear the retrieval min-length gate. */
const contentArb = fc
  .string({ minLength: MIN_MESSAGE_LEN_FOR_RETRIEVAL, maxLength: 400 })
  .filter((s) => s.trim().length >= MIN_MESSAGE_LEN_FOR_RETRIEVAL);

const memoryArb: fc.Arbitrary<CreateMemoryInput> = fc.record({
  content: contentArb,
  memoryType: memoryTypeArb,
  source: sourceArb,
});

/** Seed a repository with `count` memories for `userId` via the stub embedder. */
async function seed(
  repo: InMemoryMemoryRepository,
  embeddings: StubEmbeddingService,
  userId: string,
  memories: CreateMemoryInput[],
): Promise<void> {
  for (const input of memories) {
    const embedding = await embeddings.embed(input.content);
    await repo.insert(userId, {
      ...input,
      importance: 'medium',
      confidence: 0.6,
      embedding,
    });
  }
}

function buildRetriever(
  repo: InMemoryMemoryRepository,
  embeddings: StubEmbeddingService,
): MemoryRetriever {
  return new MemoryRetriever(
    repo.asRepository() as MemoryRepository,
    embeddings as unknown as EmbeddingService,
  );
}

describe('MemoryRetriever (Property: scoped retrieval and bounded context)', () => {
  /**
   * Feature: victor-v2-memory, Property 8.2: For any user and query, retrieved
   * memories belong only to that user, all pass the similarity threshold, and
   * the injected context never exceeds MAX_CONTEXT_MEMORIES/MAX_CONTEXT_CHARS.
   * Validates: Requirements 2.3, 6.1, 6.2, 12.2
   */
  it('returns only owned memories above threshold and a bounded context block', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(memoryArb, { minLength: 1, maxLength: 20 }),
        fc.array(memoryArb, { minLength: 0, maxLength: 20 }),
        contentArb,
        async (ownerMemories, otherMemories, rawQuery) => {
          const repo = new InMemoryMemoryRepository();
          const embeddings = new StubEmbeddingService();
          const retriever = buildRetriever(repo, embeddings);
          const owner = 'user-owner';
          const other = 'user-other';

          await seed(repo, embeddings, owner, ownerMemories);
          await seed(repo, embeddings, other, otherMemories);

          const ownedIds = new Set(
            [...repo.rows.values()]
              .filter((r) => r.userId === owner)
              .map((r) => r.id),
          );

          const matches = await retriever.getRelevant(owner, rawQuery);

          // Scoped to the caller only (Requirements 2.3, 6.1).
          for (const match of matches) {
            expect(ownedIds.has(match.id)).toBe(true);
            expect(match.userId).toBe(owner);
          }

          // All matches clear the similarity threshold (Requirement 6.2).
          for (const match of matches) {
            expect(match.similarity).toBeGreaterThanOrEqual(MIN_SIMILARITY);
          }

          // Context block is bounded in both memory count and characters
          // (Requirement 12.2).
          const context = await retriever.buildContext(owner, rawQuery);
          expect(context.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
          if (context.length > 0) {
            const bulletLines = context
              .split('\n')
              .filter((l) => l.startsWith('- '));
            expect(bulletLines.length).toBeLessThanOrEqual(
              MAX_CONTEXT_MEMORIES,
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
