import * as fc from 'fast-check';
import { EmbeddingService } from '../embeddings/embedding.service';
import { MemoryService } from './memory.service';
import {
  InMemoryMemoryRepository,
  StubEmbeddingService,
} from './memory.service.test-util';
import { CreateMemoryInput, MemoryType } from './memory.types';

/**
 * Feature: victor-v2-memory, Property 4.4: For any memory and a near-identical
 * new memory (cosine ≥ DEDUP_SIMILARITY), the store count is unchanged and the
 * existing memory is reinforced; for any conflicting same-type memory, the old
 * one is superseded and the new one becomes active.
 * Validates: Requirements 7.1, 7.2
 */

function buildService(repo: InMemoryMemoryRepository): MemoryService {
  return new MemoryService(
    repo.asRepository(),
    new StubEmbeddingService() as unknown as EmbeddingService,
  );
}

const contentArb = fc
  .string({ minLength: 3 })
  .filter((s) => s.trim().length >= 3);

const supersedingTypeArb = fc.constantFrom(
  'preference',
  'personal_fact',
) as fc.Arbitrary<MemoryType>;

describe('MemoryService (Property: dedup and conflict handling)', () => {
  it('reinforces an existing memory for near-identical content without duplicating', async () => {
    await fc.assert(
      fc.asyncProperty(contentArb, supersedingTypeArb, async (content, type) => {
        const repo = new InMemoryMemoryRepository();
        const service = buildService(repo);
        const userId = 'user-1';

        const first: CreateMemoryInput = {
          content,
          memoryType: type,
          source: 'auto_extracted',
        };
        const created = await service.createMemory(userId, first);

        // Identical content -> cosine 1.0 >= DEDUP_SIMILARITY.
        const second: CreateMemoryInput = {
          content,
          memoryType: type,
          source: 'user_explicit',
        };
        const result = await service.createMemory(userId, second);

        // Store count unchanged: reinforcement, not a new row.
        expect(repo.rows.size).toBe(1);
        // Same underlying memory returned.
        expect(result.id).toBe(created.id);
        // Reinforced: importance/confidence bumped to the stronger explicit
        // values, and reinforcement recorded in metadata.
        const stored = repo.rows.get(created.id);
        expect(stored?.importance).toBe('high');
        expect(stored?.confidence).toBeGreaterThanOrEqual(0.95);
        expect(stored?.metadata.reinforcedAt).toBeDefined();
      }),
      { numRuns: 100 },
    );
  });

  it('supersedes a conflicting same-type memory and activates the new one', async () => {
    await fc.assert(
      fc.asyncProperty(supersedingTypeArb, async (type) => {
        const repo = new InMemoryMemoryRepository();
        const service = buildService(repo);
        const userId = 'user-1';

        // Two distinct-but-same-type memories on the same topic conflict.
        const oldMem = await service.createMemory(userId, {
          content: 'lives in Mumbai',
          memoryType: type,
          source: 'auto_extracted',
        });
        const newMem = await service.createMemory(userId, {
          content: 'lives in Pune, India',
          memoryType: type,
          source: 'auto_extracted',
        });

        // Two rows: old superseded, new active.
        expect(repo.rows.size).toBe(2);
        const oldStored = repo.rows.get(oldMem.id);
        const newStored = repo.rows.get(newMem.id);
        expect(oldStored?.status).toBe('superseded');
        expect(oldStored?.metadata.supersededAt).toBeDefined();
        expect(newStored?.status).toBe('active');
      }),
      { numRuns: 100 },
    );
  });

  it('keeps unrelated same-type memories side by side', async () => {
    const repo = new InMemoryMemoryRepository();
    const service = buildService(repo);
    const userId = 'user-1';

    const first = await service.createMemory(userId, {
      content: 'zzz qqq xxx',
      memoryType: 'preference',
      source: 'auto_extracted',
    });
    await service.createMemory(userId, {
      content: 'aaa bbb ccc',
      memoryType: 'preference',
      source: 'auto_extracted',
    });

    expect(repo.rows.size).toBe(2);
    expect(repo.rows.get(first.id)?.status).toBe('active');
  });
});
