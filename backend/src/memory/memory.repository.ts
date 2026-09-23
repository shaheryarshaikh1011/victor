import { BadRequestException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../auth/supabase.service';
import {
  CreateMemoryInput,
  Importance,
  Memory,
  MemorySearchOptions,
  MemorySource,
  MemoryStatus,
  MemoryType,
  UpdateMemoryInput,
} from './memory.types';

/**
 * Shape of a `memories` row as returned by Supabase selects. Kept local to the
 * repository so mapping to the `Memory` domain type is centralized here.
 */
interface MemoryRow {
  id: string;
  user_id: string;
  content: string;
  memory_type: MemoryType;
  source: MemorySource;
  source_conversation_id: string | null;
  importance: Importance;
  confidence: number;
  status: MemoryStatus;
  embedding: number[] | string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  last_accessed_at: string;
}

/** A single result row from the `match_memories` SQL function. */
export interface MemoryMatch extends Memory {
  similarity: number;
  score: number;
}

/** Columns selected for domain rows (embedding included for internal use). */
const MEMORY_COLUMNS =
  'id, user_id, content, memory_type, source, source_conversation_id, ' +
  'importance, confidence, status, embedding, metadata, ' +
  'created_at, updated_at, last_accessed_at';

/**
 * Wraps all Supabase access for memories via `SupabaseService.admin`
 * (Requirements 1.1, 2.1, 3.2, 12.2). Every mutating/reading query is scoped to
 * `user_id` so ownership is enforced independently of the frontend, and the
 * repository maps raw rows to the `Memory` domain type. Higher layers add the
 * ownership guard and API-safe projection.
 */
@Injectable()
export class MemoryRepository {
  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Persists a new memory for the owning user (Requirement 1.1). Importance,
   * confidence, and metadata are expected to be resolved by the caller.
   */
  async insert(
    userId: string,
    input: CreateMemoryInput & {
      importance: Importance;
      confidence: number;
      embedding: number[] | null;
      embeddingModel: string | null;
    },
  ): Promise<Memory> {
    const now = new Date().toISOString();
    const { data, error } = await this.supabase.admin
      .from('memories')
      .insert({
        user_id: userId,
        content: input.content,
        memory_type: input.memoryType,
        source: input.source,
        source_conversation_id: input.sourceConversationId ?? null,
        importance: input.importance,
        confidence: input.confidence,
        status: 'active',
        embedding: input.embedding,
        embedding_model: input.embedding ? input.embeddingModel : null,
        metadata: input.metadata ?? {},
        created_at: now,
        updated_at: now,
        last_accessed_at: now,
      })
      .select(MEMORY_COLUMNS)
      .single();

    if (error || !data) {
      throw new BadRequestException('Failed to create memory');
    }

    return this.toMemory(data as unknown as MemoryRow);
  }

  /**
   * Loads a single memory by id scoped to the owning user (Requirement 2.1).
   * Returns null when no such owned memory exists.
   */
  async findById(userId: string, id: string): Promise<Memory | null> {
    const { data, error } = await this.supabase.admin
      .from('memories')
      .select(MEMORY_COLUMNS)
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new BadRequestException('Failed to read memory');
    }

    return data ? this.toMemory(data as unknown as MemoryRow) : null;
  }

  /**
   * Lists a user's memories with optional type/status/text filtering, ordering,
   * and pagination in a single query (Requirements 3.2, 12.2). Defaults to
   * active memories ordered by most recently created.
   */
  async list(
    userId: string,
    options: MemorySearchOptions = {},
    pagination: { limit?: number; offset?: number } = {},
  ): Promise<Memory[]> {
    let query = this.supabase.admin
      .from('memories')
      .select(MEMORY_COLUMNS)
      .eq('user_id', userId);

    if (options.status) {
      query = query.eq('status', options.status);
    }
    if (options.memoryType) {
      query = query.eq('memory_type', options.memoryType);
    }
    if (options.search) {
      // Case-insensitive text match backed by the GIN trigram index.
      query = query.ilike('content', `%${options.search}%`);
    }

    query = query.order('created_at', { ascending: false });

    const limit = pagination.limit;
    const offset = pagination.offset ?? 0;
    if (typeof limit === 'number') {
      query = query.range(offset, offset + limit - 1);
    }

    const { data, error } = await query;

    if (error) {
      throw new BadRequestException('Failed to list memories');
    }

    return (data ?? []).map((row) => this.toMemory(row as unknown as MemoryRow));
  }

  /**
   * Runs the user-scoped `match_memories` SQL function for semantic retrieval
   * in a single round trip (Requirements 2.3, 12.2). Only memories embedded by
   * `embeddingModel` are compared, since vectors from different models are not
   * comparable. Returns matches ordered by combined relevance score.
   */
  async matchMemories(
    userId: string,
    queryEmbedding: number[],
    k: number,
    minSimilarity: number,
    embeddingModel: string,
  ): Promise<MemoryMatch[]> {
    const { data, error } = await this.supabase.admin.rpc('match_memories', {
      p_user_id: userId,
      p_query: queryEmbedding as unknown as string,
      p_k: k,
      p_min_sim: minSimilarity,
      p_model: embeddingModel,
    });

    if (error) {
      throw new BadRequestException('Failed to search memories');
    }

    return ((data ?? []) as (MemoryRow & {
      similarity: number;
      score: number;
    })[]).map((row) => ({
      ...this.toMemory(row),
      similarity: Number(row.similarity),
      score: Number(row.score),
    }));
  }

  /**
   * Advances `last_accessed_at` for memories injected into a prompt
   * (Requirement 6.4). Kept separate from `matchMemories` so retrieval stays a
   * read and this write can run off the response path.
   */
  async touch(userId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    const { error } = await this.supabase.admin.rpc('touch_memories', {
      p_user_id: userId,
      p_ids: ids,
    });
    if (error) {
      throw new BadRequestException('Failed to touch memories');
    }
  }

  /**
   * Lists memories (across all users) whose embedding is missing or was made
   * by a different model, for background re-embedding.
   */
  async listStaleEmbeddings(
    embeddingModel: string,
    limit: number,
  ): Promise<{ id: string; userId: string; content: string }[]> {
    const { data, error } = await this.supabase.admin
      .from('memories')
      .select('id, user_id, content')
      .or(`embedding_model.is.null,embedding_model.neq."${embeddingModel}"`)
      .limit(limit);

    if (error) {
      throw new BadRequestException('Failed to list stale embeddings');
    }

    return (data ?? []).map((row) => ({
      id: row.id as string,
      userId: row.user_id as string,
      content: row.content as string,
    }));
  }

  /**
   * Applies a partial update to an owned memory in a single ownership-scoped
   * statement (`UPDATE ... WHERE id = ? AND user_id = ?`) (Requirement 2.1).
   * Returns null when no owned memory matched.
   */
  async update(
    userId: string,
    id: string,
    changes: UpdateMemoryInput & {
      embedding?: number[] | null;
      embeddingModel?: string | null;
    },
  ): Promise<Memory | null> {
    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (changes.content !== undefined) patch.content = changes.content;
    if (changes.memoryType !== undefined)
      patch.memory_type = changes.memoryType;
    if (changes.importance !== undefined) patch.importance = changes.importance;
    if (changes.confidence !== undefined) patch.confidence = changes.confidence;
    if (changes.status !== undefined) patch.status = changes.status;
    if (changes.metadata !== undefined) patch.metadata = changes.metadata;
    if (changes.embedding !== undefined) {
      patch.embedding = changes.embedding;
      patch.embedding_model = changes.embedding
        ? (changes.embeddingModel ?? null)
        : null;
    }

    const { data, error } = await this.supabase.admin
      .from('memories')
      .update(patch)
      .eq('id', id)
      .eq('user_id', userId)
      .select(MEMORY_COLUMNS)
      .maybeSingle();

    if (error) {
      throw new BadRequestException('Failed to update memory');
    }

    return data ? this.toMemory(data as unknown as MemoryRow) : null;
  }

  /**
   * Deletes a single owned memory (Requirement 2.1). Returns true when a row
   * was removed, false when nothing matched.
   */
  async delete(userId: string, id: string): Promise<boolean> {
    const { data, error } = await this.supabase.admin
      .from('memories')
      .delete()
      .eq('id', id)
      .eq('user_id', userId)
      .select('id');

    if (error) {
      throw new BadRequestException('Failed to delete memory');
    }

    return (data ?? []).length > 0;
  }

  /** Deletes all of a user's memories (Requirement 2.1). */
  async deleteAll(userId: string): Promise<void> {
    const { error } = await this.supabase.admin
      .from('memories')
      .delete()
      .eq('user_id', userId);

    if (error) {
      throw new BadRequestException('Failed to delete memories');
    }
  }

  /** Maps a raw `memories` row to the `Memory` domain type. */
  private toMemory(row: MemoryRow): Memory {
    return {
      id: row.id,
      userId: row.user_id,
      content: row.content,
      memoryType: row.memory_type,
      source: row.source,
      sourceConversationId: row.source_conversation_id,
      importance: row.importance,
      confidence: Number(row.confidence),
      status: row.status,
      embedding: this.parseEmbedding(row.embedding),
      metadata: row.metadata ?? {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastAccessedAt: row.last_accessed_at,
    };
  }

  /**
   * pgvector columns may arrive as a JS array or as the textual `[a,b,c]`
   * representation depending on the driver. Normalize to `number[] | null`.
   */
  private parseEmbedding(value: number[] | string | null): number[] | null {
    if (value == null) {
      return null;
    }
    if (Array.isArray(value)) {
      return value;
    }
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}
