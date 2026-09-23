import { Injectable, Logger } from '@nestjs/common';
import { EmbeddingService } from '../../embeddings/embedding.service';
import {
  MAX_CONTEXT_CHARS,
  MAX_CONTEXT_MEMORIES,
  MIN_MESSAGE_LEN_FOR_RETRIEVAL,
  MIN_SIMILARITY,
  TOP_K,
} from '../memory.constants';
import { MemoryMatch, MemoryRepository } from '../memory.repository';

/** Header prefixed to the injected memory context block (Requirement 6.3). */
const CONTEXT_HEADER = 'Relevant memories about the user:';

/**
 * Semantic retrieval and prompt-context construction (Requirements 6.1–6.4).
 *
 * `getRelevant` generates a query embedding and runs the user-scoped
 * `match_memories` SQL function (top-K + similarity threshold), so every match
 * belongs to the caller and clears the relevance bar (Requirements 2.3, 6.1,
 * 6.2). `buildContext` renders those matches into a single formatted block
 * bounded by {@link MAX_CONTEXT_MEMORIES} and {@link MAX_CONTEXT_CHARS} so the
 * injected tokens stay bounded regardless of how many memories are stored
 * (Requirement 12.2).
 *
 * Resilience: every path is wrapped so an embedding/search failure yields an
 * empty result and never throws, keeping the V1 chat pipeline alive
 * (Requirement 11.1).
 */
@Injectable()
export class MemoryRetriever {
  private readonly logger = new Logger(MemoryRetriever.name);

  constructor(
    private readonly repo: MemoryRepository,
    private readonly embeddings: EmbeddingService,
  ) {}

  /**
   * Retrieve the memories most relevant to `query` for the caller
   * (Requirements 6.1, 6.2). Short queries and any failure short-circuit to an
   * empty list so retrieval never blocks or breaks a reply (Requirement 11.1).
   * The `match_memories` call also advances `last_accessed_at` for the returned
   * rows in the same round trip (Requirement 6.4).
   */
  async getRelevant(
    userId: string,
    query: string,
    k: number = TOP_K,
    minSimilarity: number = MIN_SIMILARITY,
  ): Promise<MemoryMatch[]> {
    const trimmed = query.trim();
    // Avoid unnecessary embedding calls for trivially short queries
    // (Requirement 12.2).
    if (trimmed.length < MIN_MESSAGE_LEN_FOR_RETRIEVAL) {
      return [];
    }

    try {
      const embedding = await this.embeddings.embed(trimmed);
      if (!embedding) {
        return [];
      }
      return await this.repo.matchMemories(userId, embedding, k, minSimilarity);
    } catch (err) {
      // No memory content is logged, only the failure (Requirement 12.1).
      this.logger.warn(`getRelevant failed: ${(err as Error).message}`);
      return [];
    }
  }

  /**
   * Build a formatted memory context block for the caller's `query`
   * (Requirement 6.3). The block is capped at {@link MAX_CONTEXT_MEMORIES}
   * entries and {@link MAX_CONTEXT_CHARS} characters; returns an empty string
   * when there is nothing relevant or on any failure (Requirement 11.1).
   */
  async buildContext(userId: string, query: string): Promise<string> {
    try {
      const matches = await this.getRelevant(userId, query);
      return this.formatContext(matches);
    } catch (err) {
      this.logger.warn(`buildContext failed: ${(err as Error).message}`);
      return '';
    }
  }

  /**
   * Render matches into the bounded context block. Entries are added in
   * relevance order until either the memory-count or character cap is reached,
   * guaranteeing the result never exceeds {@link MAX_CONTEXT_MEMORIES} lines or
   * {@link MAX_CONTEXT_CHARS} characters (Requirement 12.2).
   */
  private formatContext(matches: MemoryMatch[]): string {
    if (matches.length === 0) {
      return '';
    }

    const lines: string[] = [];
    let length = CONTEXT_HEADER.length;

    for (const match of matches.slice(0, MAX_CONTEXT_MEMORIES)) {
      const line = `- ${match.content}`;
      // +1 accounts for the newline separator joining this line to the block.
      if (length + line.length + 1 > MAX_CONTEXT_CHARS) {
        break;
      }
      lines.push(line);
      length += line.length + 1;
    }

    if (lines.length === 0) {
      return '';
    }

    return [CONTEXT_HEADER, ...lines].join('\n');
  }
}
