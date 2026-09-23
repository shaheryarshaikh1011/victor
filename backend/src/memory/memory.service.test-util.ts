import { randomUUID } from 'crypto';
import { EMBEDDING_DIMENSION } from '../embeddings/embedding.types';
import { MemoryMatch, MemoryRepository } from './memory.repository';
import {
  CreateMemoryInput,
  Importance,
  Memory,
  MemorySearchOptions,
  UpdateMemoryInput,
} from './memory.types';

/**
 * In-memory backing store used by the memory service tests. It implements the
 * same surface as {@link MemoryRepository} against a real Map so tests exercise
 * the service's ownership/dedup/conflict logic without mocking behavior. Cosine
 * similarity is computed for real over the stored embeddings.
 */
export class InMemoryMemoryRepository {
  readonly rows = new Map<string, Memory>();

  async insert(
    userId: string,
    input: CreateMemoryInput & {
      importance: Importance;
      confidence: number;
      embedding: number[] | null;
    },
  ): Promise<Memory> {
    const now = new Date().toISOString();
    const memory: Memory = {
      id: randomUUID(),
      userId,
      content: input.content,
      memoryType: input.memoryType,
      source: input.source,
      sourceConversationId: input.sourceConversationId ?? null,
      importance: input.importance,
      confidence: input.confidence,
      status: 'active',
      embedding: input.embedding,
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
    };
    this.rows.set(memory.id, memory);
    return { ...memory };
  }

  async findById(userId: string, id: string): Promise<Memory | null> {
    const row = this.rows.get(id);
    if (!row || row.userId !== userId) {
      return null;
    }
    return { ...row };
  }

  async list(
    userId: string,
    options: MemorySearchOptions = {},
  ): Promise<Memory[]> {
    return [...this.rows.values()]
      .filter((row) => row.userId === userId)
      .filter((row) => (options.status ? row.status === options.status : true))
      .filter((row) =>
        options.memoryType ? row.memoryType === options.memoryType : true,
      )
      .filter((row) =>
        options.search
          ? row.content.toLowerCase().includes(options.search.toLowerCase())
          : true,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((row) => ({ ...row }));
  }

  async matchMemories(
    userId: string,
    queryEmbedding: number[],
    k: number,
    minSimilarity: number,
  ): Promise<MemoryMatch[]> {
    const now = new Date().toISOString();
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.userId === userId && row.status === 'active' && row.embedding,
      )
      .map((row) => {
        const similarity = cosine(queryEmbedding, row.embedding as number[]);
        return { ...row, lastAccessedAt: now, similarity, score: similarity };
      })
      .filter((row) => row.similarity >= minSimilarity)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  async update(
    userId: string,
    id: string,
    changes: UpdateMemoryInput & { embedding?: number[] | null },
  ): Promise<Memory | null> {
    const row = this.rows.get(id);
    if (!row || row.userId !== userId) {
      return null;
    }
    const updated: Memory = {
      ...row,
      ...(changes.content !== undefined ? { content: changes.content } : {}),
      ...(changes.memoryType !== undefined
        ? { memoryType: changes.memoryType }
        : {}),
      ...(changes.importance !== undefined
        ? { importance: changes.importance }
        : {}),
      ...(changes.confidence !== undefined
        ? { confidence: changes.confidence }
        : {}),
      ...(changes.status !== undefined ? { status: changes.status } : {}),
      ...(changes.metadata !== undefined ? { metadata: changes.metadata } : {}),
      ...(changes.embedding !== undefined
        ? { embedding: changes.embedding }
        : {}),
      updatedAt: new Date().toISOString(),
    };
    this.rows.set(id, updated);
    return { ...updated };
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.userId !== userId) {
      return false;
    }
    this.rows.delete(id);
    return true;
  }

  async deleteAll(userId: string): Promise<void> {
    for (const [id, row] of this.rows) {
      if (row.userId === userId) {
        this.rows.delete(id);
      }
    }
  }

  asRepository(): MemoryRepository {
    return this as unknown as MemoryRepository;
  }
}

/**
 * Deterministic embedding stub that maps text to a fixed-dimension unit vector.
 * Identical text yields identical vectors, so near-identical content produces
 * cosine ≈ 1 and distinct content produces low similarity.
 */
export class StubEmbeddingService {
  async embed(text: string): Promise<number[] | null> {
    const normalized = text.trim().toLowerCase();
    const vec = new Array<number>(EMBEDDING_DIMENSION).fill(0);
    for (let i = 0; i < normalized.length; i++) {
      const code = normalized.charCodeAt(i);
      vec[code % EMBEDDING_DIMENSION] += 1;
    }
    // Ensure a non-zero vector even for empty/whitespace text.
    vec[0] += 1;
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    return vec.map((v) => v / norm);
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) {
    return 0;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
