import * as fc from 'fast-check';
import { EmbeddingService } from '../../embeddings/embedding.service';
import { MemoryService } from '../memory.service';
import {
  InMemoryMemoryRepository,
  StubEmbeddingService,
} from '../memory.service.test-util';
import { CreateMemoryInput } from '../memory.types';
import { MemoryExtractor } from './memory-extractor.service';
import { MemoryManager } from './memory-manager.service';
import { MemoryRetriever } from './memory-retriever.service';

/**
 * Feature: victor-v2-memory, Property 9.4: For any forget command that matches
 * no stored memory above threshold, the manager reports nothing matched and no
 * memory is deleted or invalidated.
 * Validates: Requirements 4.3
 */

const USER_ID = 'user-forget';

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

const createInputArb: fc.Arbitrary<CreateMemoryInput> = fc.record({
  content: fc.string({ minLength: 1, maxLength: 120 }).filter((s) => s.trim().length > 0),
  memoryType: memoryTypeArb,
  source: sourceArb,
});

/**
 * MemoryExtractor stub: classifies the message as a forget command and returns
 * the provided search query verbatim. No AI is called; the real
 * MemoryService/retrieval logic decides whether anything matches.
 */
function stubExtractor(forgetQuery: string): MemoryExtractor {
  return {
    detectCommand: () => ({ type: 'forget', payload: forgetQuery }),
    buildForgetQuery: async () => forgetQuery,
  } as unknown as MemoryExtractor;
}

function buildService(repo: InMemoryMemoryRepository): MemoryService {
  return new MemoryService(
    repo.asRepository(),
    new StubEmbeddingService() as unknown as EmbeddingService,
  );
}

describe('MemoryManager (Property: forget with no match)', () => {
  it('reports nothing matched and leaves the store unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(createInputArb, { minLength: 0, maxLength: 10 }),
        fc.string({ minLength: 4, maxLength: 120 }).filter((s) => s.trim().length >= 4),
        async (seedMemories, forgetQuery) => {
          const repo = new InMemoryMemoryRepository();
          const service = buildService(repo);
          const manager = new MemoryManager(
            service,
            stubExtractor(forgetQuery),
            {} as unknown as MemoryRetriever,
          );

          for (const input of seedMemories) {
            await service.createMemory(USER_ID, input);
          }

          // Precondition: the forget query genuinely matches nothing above the
          // similarity threshold. Only then does Requirement 4.3 apply.
          const relevant = await service.getRelevantMemories(
            USER_ID,
            forgetQuery,
            1,
          );
          fc.pre(relevant.length === 0);

          const before = new Map(repo.rows);

          const result = await manager.handleUserMessage(
            USER_ID,
            'conv-1',
            `forget ${forgetQuery}`,
          );

          // Command is handled but reports that nothing matched.
          expect(result.handled).toBe(true);
          expect(result.reply).toContain('nothing to forget');

          // No memory was deleted or invalidated: the store is byte-for-byte
          // identical (Requirement 4.3).
          expect(repo.rows.size).toBe(before.size);
          for (const [id, row] of before) {
            expect(repo.rows.get(id)).toEqual(row);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
