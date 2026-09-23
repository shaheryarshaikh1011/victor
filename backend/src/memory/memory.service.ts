import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EmbeddingService } from '../embeddings/embedding.service';
import {
  CONFLICT_SIMILARITY,
  DEDUP_SIMILARITY,
  MIN_SIMILARITY,
  TOP_K,
  defaultConfidence,
  defaultImportance,
} from './memory.constants';
import { MemoryMatch, MemoryRepository } from './memory.repository';
import {
  CreateMemoryInput,
  Importance,
  Memory,
  MemorySearchOptions,
  MemoryType,
  MemoryView,
  UpdateMemoryInput,
} from './memory.types';

/** Memory types for which a same-type conflict supersedes the older memory. */
const SUPERSEDING_TYPES: ReadonlySet<MemoryType> = new Set<MemoryType>([
  'preference',
  'personal_fact',
]);

/** Ordering of importance levels for reinforcement bumps. */
const IMPORTANCE_ORDER: readonly Importance[] = ['low', 'medium', 'high'];

/**
 * Public memory operations scoped to the Authenticated_User_Id
 * (Requirements 1.x, 2.x, 3.x, 7.x).
 *
 * Ownership is enforced in this service layer exactly like
 * `ConversationsService.assertOwned`: a memory owned by another user is never
 * returned or mutated (Requirements 2.1, 2.2). Read/list operations return
 * `MemoryView`, which never exposes the embedding (Requirement 3.3).
 *
 * `createMemory` resolves default importance/confidence by type/source
 * (Requirements 1.3, 1.4) and performs deduplication/conflict resolution using
 * a single nearest-neighbour lookup (Requirements 7.1, 7.2).
 */
@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);

  constructor(
    private readonly repo: MemoryRepository,
    private readonly embeddings: EmbeddingService,
  ) {}

  /**
   * Create a memory for the caller. Assigns default importance/confidence when
   * omitted, generates an embedding, and applies dedup/conflict resolution
   * before inserting (Requirements 1.1, 1.3, 1.4, 7.1, 7.2).
   */
  async createMemory(
    userId: string,
    input: CreateMemoryInput,
  ): Promise<MemoryView> {
    const importance =
      input.importance ?? defaultImportance(input.memoryType, input.source);
    const confidence =
      input.confidence ?? defaultConfidence(input.memoryType, input.source);

    const embedding = await this.embeddings.embed(input.content);

    // Dedup/conflict resolution requires a vector to compare against. When no
    // embedding is available we skip straight to insert.
    if (embedding) {
      const resolved = await this.resolveDuplicateOrConflict(
        userId,
        input,
        embedding,
        importance,
        confidence,
      );
      if (resolved) {
        return this.toView(resolved);
      }
    }

    const created = await this.repo.insert(userId, {
      ...input,
      importance,
      confidence,
      embedding,
      embeddingModel: this.embeddings.modelId,
    });
    return this.toView(created);
  }

  /**
   * Return an owned memory as an API-safe view (Requirements 2.1, 2.2, 3.3).
   * Rejects when the memory is missing or owned by another user.
   */
  async getMemory(userId: string, id: string): Promise<MemoryView> {
    const memory = await this.assertOwned(userId, id);
    return this.toView(memory);
  }

  /**
   * List the caller's memories with optional type/status/text filtering
   * (Requirements 2.1, 3.2, 3.3). Never returns another user's memories.
   */
  async searchMemories(
    userId: string,
    options: MemorySearchOptions = {},
  ): Promise<MemoryView[]> {
    const memories = await this.repo.list(userId, options);
    return memories.map((memory) => this.toView(memory));
  }

  /**
   * Semantic retrieval scoped to the caller (Requirement 2.3). Returns an
   * empty list when no embedding is available.
   */
  async getRelevantMemories(
    userId: string,
    query: string,
    k: number = TOP_K,
    minSimilarity: number = MIN_SIMILARITY,
  ): Promise<MemoryView[]> {
    const embedding = await this.embeddings.embed(query);
    if (!embedding) {
      return [];
    }
    const matches = await this.repo.matchMemories(
      userId,
      embedding,
      k,
      minSimilarity,
      this.embeddings.modelId,
    );
    return matches.map((match) => this.toView(match));
  }

  /**
   * Update an owned memory (Requirements 2.1, 2.2). Rejects updates to a
   * memory owned by another user without mutating it.
   */
  async updateMemory(
    userId: string,
    id: string,
    changes: UpdateMemoryInput,
  ): Promise<MemoryView> {
    await this.assertOwned(userId, id);

    let embedding: number[] | null | undefined;
    if (changes.content !== undefined) {
      embedding = await this.embeddings.embed(changes.content);
    }

    const updated = await this.repo.update(userId, id, {
      ...changes,
      ...(embedding !== undefined
        ? { embedding, embeddingModel: this.embeddings.modelId }
        : {}),
    });
    if (!updated) {
      throw new NotFoundException('Memory not found');
    }
    return this.toView(updated);
  }

  /**
   * Delete an owned memory (Requirements 2.1, 2.2). Rejects deletion of a
   * memory owned by another user without removing it.
   */
  async deleteMemory(userId: string, id: string): Promise<void> {
    await this.assertOwned(userId, id);
    const deleted = await this.repo.delete(userId, id);
    if (!deleted) {
      throw new NotFoundException('Memory not found');
    }
  }

  /**
   * Soft-forget an owned memory: marks it superseded so it drops out of
   * retrieval while remaining restorable from the memory page.
   */
  async forgetMemory(userId: string, id: string): Promise<void> {
    const memory = await this.assertOwned(userId, id);
    await this.repo.update(userId, id, {
      status: 'superseded',
      metadata: { ...memory.metadata, forgottenAt: new Date().toISOString() },
    });
  }

  /**
   * Re-embeds up to `limit` memories whose vector is missing or came from a
   * different embedding model, so switching providers never silently breaks
   * retrieval. Returns how many memories were re-embedded.
   */
  async reembedStale(limit: number): Promise<number> {
    const stale = await this.repo.listStaleEmbeddings(
      this.embeddings.modelId,
      limit,
    );
    let count = 0;
    for (const memory of stale) {
      const embedding = await this.embeddings.embed(memory.content);
      if (!embedding) {
        // Provider unavailable; retry on the next run.
        break;
      }
      await this.repo.update(memory.userId, memory.id, {
        embedding,
        embeddingModel: this.embeddings.modelId,
      });
      count += 1;
    }
    return count;
  }

  /** Delete all of the caller's memories (Requirement 2.1). */
  async deleteAllMemories(userId: string): Promise<void> {
    await this.repo.deleteAll(userId);
  }

  /**
   * Deduplication and conflict resolution driven by a single `match_memories`
   * (k=1) lookup (Requirements 7.1, 7.2).
   *
   * - Near-identical (cosine ≥ DEDUP_SIMILARITY): reinforce the existing memory
   *   by bumping importance/confidence and refreshing its timestamp.
   * - Conflicting same-type preference/personal_fact below the dedup threshold:
   *   supersede the old memory (status=superseded, metadata.supersededBy) and
   *   insert the new one as active.
   *
   * Returns the memory to expose to the caller when the create was resolved via
   * reinforcement, otherwise `null` to signal a normal insert should proceed.
   */
  private async resolveDuplicateOrConflict(
    userId: string,
    input: CreateMemoryInput,
    embedding: number[],
    importance: Importance,
    confidence: number,
  ): Promise<Memory | null> {
    let nearest: MemoryMatch | undefined;
    try {
      const matches = await this.repo.matchMemories(
        userId,
        embedding,
        1,
        0,
        this.embeddings.modelId,
      );
      nearest = matches[0];
    } catch (err) {
      // A failed similarity probe must not block memory creation.
      this.logger.warn(
        `Dedup lookup failed, inserting without dedup: ${
          (err as Error).message
        }`,
      );
      return null;
    }

    if (!nearest) {
      return null;
    }

    if (nearest.similarity >= DEDUP_SIMILARITY) {
      return this.reinforce(userId, nearest, importance, confidence);
    }

    if (
      nearest.similarity >= CONFLICT_SIMILARITY &&
      SUPERSEDING_TYPES.has(input.memoryType) &&
      nearest.memoryType === input.memoryType &&
      nearest.status === 'active'
    ) {
      await this.supersede(userId, nearest);
    }

    return null;
  }

  /**
   * Reinforce an existing memory: keep the stronger importance/confidence and
   * refresh recency (Requirement 7.1).
   */
  private async reinforce(
    userId: string,
    existing: Memory,
    importance: Importance,
    confidence: number,
  ): Promise<Memory> {
    const nextImportance = this.maxImportance(existing.importance, importance);
    const nextConfidence = Math.max(existing.confidence, confidence);

    const updated = await this.repo.update(userId, existing.id, {
      importance: nextImportance,
      confidence: nextConfidence,
      metadata: {
        ...existing.metadata,
        reinforcedAt: new Date().toISOString(),
      },
    });
    // If the update raced away, fall back to the existing memory.
    return updated ?? existing;
  }

  /**
   * Soft-invalidate a conflicting memory in a single ownership-scoped update,
   * recording the change in metadata (Requirement 7.2).
   */
  private async supersede(userId: string, existing: Memory): Promise<void> {
    await this.repo.update(userId, existing.id, {
      status: 'superseded',
      metadata: {
        ...existing.metadata,
        supersededAt: new Date().toISOString(),
      },
    });
  }

  private maxImportance(a: Importance, b: Importance): Importance {
    return IMPORTANCE_ORDER.indexOf(a) >= IMPORTANCE_ORDER.indexOf(b) ? a : b;
  }

  /**
   * Reusable ownership check mirroring `ConversationsService.assertOwned`.
   * Loads the memory and confirms it belongs to the caller. Returns a forbidden
   * error for memories owned by another user (Requirement 2.2) and a not-found
   * error when no such memory exists.
   */
  private async assertOwned(userId: string, id: string): Promise<Memory> {
    if (!id) {
      throw new BadRequestException('Memory id is required');
    }
    const memory = await this.repo.findById(userId, id);
    if (!memory) {
      throw new NotFoundException('Memory not found');
    }
    if (memory.userId !== userId) {
      throw new ForbiddenException('Memory is not owned by the caller');
    }
    return memory;
  }

  /** Project a domain memory to the API-safe view (Requirement 3.3). */
  private toView(memory: Memory): MemoryView {
    return {
      id: memory.id,
      content: memory.content,
      memoryType: memory.memoryType,
      source: memory.source,
      sourceConversationId: memory.sourceConversationId,
      importance: memory.importance,
      confidence: memory.confidence,
      status: memory.status,
      metadata: memory.metadata,
      createdAt: memory.createdAt,
      updatedAt: memory.updatedAt,
      lastAccessedAt: memory.lastAccessedAt,
    };
  }
}
