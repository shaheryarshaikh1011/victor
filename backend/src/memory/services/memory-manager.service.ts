import { Injectable, Logger } from '@nestjs/common';
import { MemoryService } from '../memory.service';
import { DetectedCommand, MemoryExtractor } from './memory-extractor.service';
import { MemoryRetriever } from './memory-retriever.service';
import { MemoryView } from '../memory.types';
import { FORGET_MIN_SIMILARITY } from '../memory.constants';

/**
 * Outcome of `handleUserMessage`. When `handled` is true the chat pipeline
 * should stream and persist `reply` as the assistant message without an LLM
 * call; when false the pipeline proceeds normally (Requirements 4.1, 4.2, 8.1).
 */
export interface HandledMessage {
  handled: boolean;
  reply?: string;
}

/**
 * Orchestrates memory behavior for the chat pipeline (Requirements 4.1, 4.2,
 * 4.3, 8.1, 8.2, 11.1, 11.2).
 *
 * `handleUserMessage` detects explicit remember/forget/recall commands and,
 * when matched, resolves them against the store and returns a confirmation
 * reply. Forget reports that nothing matched when no memory clears the
 * similarity threshold (Requirement 4.3), and the recall summary is built only
 * from stored memories (Requirement 8.2). `buildMemoryContext` produces the
 * bounded context block for ordinary messages, and `extractFromExchange`
 * performs fire-and-forget auto-extraction.
 *
 * Every method catches its own errors and returns a safe default so a memory
 * failure never breaks the V1 chat pipeline (Requirements 11.1, 11.2).
 */
@Injectable()
export class MemoryManager {
  private readonly logger = new Logger(MemoryManager.name);

  constructor(
    private readonly memories: MemoryService,
    private readonly extractor: MemoryExtractor,
    private readonly retriever: MemoryRetriever,
  ) {}

  /**
   * Cheap synchronous check for an explicit memory command, used to decide
   * whether the chat pipeline needs memory retrieval. False on any failure.
   */
  isCommand(text: string): boolean {
    try {
      return this.extractor.detectCommand(text) !== null;
    } catch {
      return false;
    }
  }

  /**
   * Detects and resolves an explicit memory command. Returns `{ handled:false }`
   * for ordinary chat or on any failure so the normal pipeline continues
   * (Requirements 4.1, 4.2, 4.3, 8.1, 8.2, 11.2).
   */
  async handleUserMessage(
    userId: string,
    conversationId: string,
    text: string,
  ): Promise<HandledMessage> {
    try {
      const command = this.extractor.detectCommand(text);
      if (!command) {
        return { handled: false };
      }

      switch (command.type) {
        case 'remember':
          return await this.handleRemember(userId, conversationId, command);
        case 'forget':
          return await this.handleForget(userId, command);
        case 'recall':
          return await this.handleRecall(userId);
        default:
          return { handled: false };
      }
    } catch (err) {
      this.logger.warn(
        `handleUserMessage failed: ${(err as Error).message}`,
      );
      return { handled: false };
    }
  }

  /**
   * Builds the bounded memory context block for an ordinary message
   * (Requirement 6.3). Always returns a string; empty on failure so chat
   * proceeds without memory context (Requirement 11.1).
   */
  async buildMemoryContext(userId: string, query: string): Promise<string> {
    try {
      return await this.retriever.buildContext(userId, query);
    } catch (err) {
      this.logger.warn(`buildMemoryContext failed: ${(err as Error).message}`);
      return '';
    }
  }

  /**
   * Fire-and-forget automatic extraction after a successful reply. Swallows all
   * errors so it never affects the reply path (Requirements 5.x, 11.2).
   */
  async extractFromExchange(
    userId: string,
    conversationId: string,
    userText: string,
    aiText: string,
  ): Promise<void> {
    try {
      const candidate = await this.extractor.extractFromExchange(
        userId,
        conversationId,
        userText,
        aiText,
      );
      if (candidate) {
        await this.memories.createMemory(userId, candidate);
      }
    } catch (err) {
      this.logger.warn(
        `extractFromExchange failed: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Stores an explicit remember command as a high-confidence `explicit` memory
   * and confirms it (Requirement 4.1).
   */
  private async handleRemember(
    userId: string,
    conversationId: string,
    command: DetectedCommand,
  ): Promise<HandledMessage> {
    const fact = await this.extractor.normalizeFact(userId, command);
    if (!fact.trim()) {
      return {
        handled: true,
        reply: "I couldn't tell what you'd like me to remember.",
      };
    }

    await this.memories.createMemory(userId, {
      content: fact,
      memoryType: 'explicit',
      source: 'user_explicit',
      sourceConversationId: conversationId,
    });

    return { handled: true, reply: `Got it — I'll remember that ${fact}.` };
  }

  /**
   * Finds the memory targeted by a forget command via semantic search and
   * deletes it. Reports that nothing matched when no memory clears the
   * threshold, without deleting or invalidating anything (Requirement 4.3).
   */
  private async handleForget(
    userId: string,
    command: DetectedCommand,
  ): Promise<HandledMessage> {
    const query = await this.extractor.buildForgetQuery(userId, command);
    if (!query.trim()) {
      return {
        handled: true,
        reply: "I couldn't tell which memory to forget.",
      };
    }

    const matches = await this.memories.getRelevantMemories(
      userId,
      query,
      1,
      FORGET_MIN_SIMILARITY,
    );
    const target = matches[0];
    if (!target) {
      return {
        handled: true,
        reply: "I don't have a memory matching that, so there's nothing to forget.",
      };
    }

    // Soft-forget: the memory leaves retrieval but can be restored from the
    // memory API (status back to active) if the command hit the wrong fact.
    await this.memories.forgetMemory(userId, target.id);
    return {
      handled: true,
      reply: `Done — I've forgotten that ${target.content}.`,
    };
  }

  /**
   * Summarizes the caller's stored memories in response to a recall command,
   * using only what is actually stored (Requirements 8.1, 8.2).
   */
  private async handleRecall(userId: string): Promise<HandledMessage> {
    const stored = await this.memories.searchMemories(userId, {
      status: 'active',
    });
    return { handled: true, reply: this.summarize(stored) };
  }

  /** Render stored memories into a plain summary; only stored facts appear. */
  private summarize(memories: MemoryView[]): string {
    if (memories.length === 0) {
      return "I don't have any memories stored about you yet.";
    }
    const lines = memories.map((memory) => `- ${memory.content}`);
    return ["Here's what I remember about you:", ...lines].join('\n');
  }
}
