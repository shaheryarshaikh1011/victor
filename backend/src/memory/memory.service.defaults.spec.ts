import { EmbeddingService } from '../embeddings/embedding.service';
import { BEHAVIORAL_MIN_CONFIDENCE } from './memory.constants';
import { MemoryService } from './memory.service';
import {
  InMemoryMemoryRepository,
  StubEmbeddingService,
} from './memory.service.test-util';
import { CreateMemoryInput } from './memory.types';

/**
 * Unit tests for default importance/confidence assignment (Requirements 1.3,
 * 1.4). Explicit user statements are high/0.95; auto-extracted
 * preference/personal_fact/episodic are medium/0.6; behavioral is gated by the
 * confidence threshold.
 */
function buildService(): {
  repo: InMemoryMemoryRepository;
  service: MemoryService;
} {
  const repo = new InMemoryMemoryRepository();
  const service = new MemoryService(
    repo.asRepository(),
    new StubEmbeddingService() as unknown as EmbeddingService,
  );
  return { repo, service };
}

async function create(
  service: MemoryService,
  input: CreateMemoryInput,
): Promise<{ importance: string; confidence: number }> {
  const view = await service.createMemory('user-1', input);
  return { importance: view.importance, confidence: view.confidence };
}

describe('MemoryService default importance/confidence', () => {
  it('assigns explicit user memories high importance and 0.95 confidence', async () => {
    const { service } = buildService();
    const result = await create(service, {
      content: 'remember I prefer concise answers',
      memoryType: 'explicit',
      source: 'user_explicit',
    });
    expect(result.importance).toBe('high');
    expect(result.confidence).toBeCloseTo(0.95);
  });

  it.each(['preference', 'personal_fact', 'episodic'] as const)(
    'assigns auto-extracted %s memories medium importance and 0.6 confidence',
    async (memoryType) => {
      const { service } = buildService();
      const result = await create(service, {
        content: `an auto extracted ${memoryType} fact about the user`,
        memoryType,
        source: 'auto_extracted',
      });
      expect(result.importance).toBe('medium');
      expect(result.confidence).toBeCloseTo(0.6);
    },
  );

  it('gates behavioral memories at the behavioral confidence threshold', async () => {
    const { service } = buildService();
    const result = await create(service, {
      content: 'user tends to code late at night behaviorally',
      memoryType: 'behavioral',
      source: 'auto_extracted',
    });
    expect(result.importance).toBe('low');
    expect(result.confidence).toBeCloseTo(BEHAVIORAL_MIN_CONFIDENCE);
  });

  it('respects explicit overrides for importance and confidence', async () => {
    const { service } = buildService();
    const result = await create(service, {
      content: 'a preference with an explicit override',
      memoryType: 'preference',
      source: 'auto_extracted',
      importance: 'high',
      confidence: 0.42,
    });
    expect(result.importance).toBe('high');
    expect(result.confidence).toBeCloseTo(0.42);
  });
});
