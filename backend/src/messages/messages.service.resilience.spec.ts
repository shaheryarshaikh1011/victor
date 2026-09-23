import * as fc from 'fast-check';
import { AIChunk, AIRequest, Message } from '../shared';
import { AIService } from '../ai/ai.service';
import { SupabaseService } from '../auth/supabase.service';
import { ConversationsService } from '../conversations/conversations.service';
import { UsersService } from '../users/users.service';
import { MemoryService } from '../memory/memory.service';
import { MemoryExtractor } from '../memory/services/memory-extractor.service';
import { MemoryManager } from '../memory/services/memory-manager.service';
import { MemoryRetriever } from '../memory/services/memory-retriever.service';
import { MessagesService } from './messages.service';

/**
 * Feature: victor-v2-memory, Property 9.3: For any user message, when
 * embedding/search/store/extraction throws, the V1 chat pipeline still produces
 * a reply (memory context empty) and does not error.
 * Validates: Requirements 11.1, 11.2, 13.1
 */

const USER_ID = 'user-1';
const CONV_ID = 'conv-1';

/**
 * Minimal in-memory stand-in for the messages table used by MessagesService.
 * Implements just enough of the Supabase query-builder chain that
 * `insertMessage`/`readMessages` rely on, backed by a real array so ordering
 * and round-tripping are genuine (no behavior is faked away).
 */
class FakeSupabase {
  readonly stored: Message[] = [];
  private seq = 0;

  readonly admin = {
    from: () => this.builder(),
  };

  private builder() {
    let mode: 'insert' | 'select' = 'select';
    let pendingRow: Record<string, unknown> | null = null;

    const chain: Record<string, unknown> = {
      insert: (row: Record<string, unknown>) => {
        mode = 'insert';
        pendingRow = row;
        return chain;
      },
      select: () => chain,
      eq: () => chain,
      order: () => {
        // Terminal for readMessages: resolve with ordered rows.
        return Promise.resolve({
          data: this.stored.map((m) => this.toRow(m)),
          error: null,
        });
      },
      single: () => {
        if (mode === 'insert' && pendingRow) {
          const stored = this.persist(pendingRow);
          return Promise.resolve({ data: this.toRow(stored), error: null });
        }
        return Promise.resolve({ data: null, error: { message: 'no row' } });
      },
    };
    return chain;
  }

  private persist(row: Record<string, unknown>): Message {
    this.seq += 1;
    const message: Message = {
      id: `m-${this.seq}`,
      conversationId: row.conversation_id as string,
      role: row.role as Message['role'],
      content: row.content as string,
      createdAt: new Date(this.seq).toISOString(),
    };
    this.stored.push(message);
    return message;
  }

  private toRow(m: Message) {
    return {
      id: m.id,
      conversation_id: m.conversationId,
      role: m.role,
      content: m.content,
      created_at: m.createdAt,
    };
  }
}

/** ConversationsService stub: ownership always passes for the fixed user. */
function stubConversations(): ConversationsService {
  return { getOwned: async () => undefined } as unknown as ConversationsService;
}

/** UsersService stub returning fixed settings. */
function stubUsers(): UsersService {
  return {
    getSettings: async () => ({
      userId: USER_ID,
      provider: 'gemini' as const,
      model: 'test-model',
      updatedAt: new Date().toISOString(),
    }),
  } as unknown as UsersService;
}

/**
 * AIService stub that echoes a deterministic reply and records the request so
 * the test can assert memory context was empty when memory failed.
 */
function stubAI(capture: { last?: AIRequest }): AIService {
  return {
    // eslint-disable-next-line require-yield
    async *stream(request: AIRequest): AsyncIterable<AIChunk> {
      capture.last = request;
      yield { type: 'chunk', content: 'v1-reply' };
    },
  } as unknown as AIService;
}

/**
 * A MemoryManager whose every dependency throws. Because the manager catches
 * all errors internally, the manager itself must still return safe defaults —
 * this exercises the real resilience code rather than a mock of it.
 */
function throwingMemoryManager(): MemoryManager {
  const boom = () => {
    throw new Error('memory subsystem failure');
  };
  const memoryService = {
    createMemory: boom,
    getRelevantMemories: boom,
    searchMemories: boom,
    deleteMemory: boom,
  } as unknown as MemoryService;
  const extractor = {
    detectCommand: boom,
    normalizeFact: boom,
    buildForgetQuery: boom,
    extractFromExchange: boom,
  } as unknown as MemoryExtractor;
  const retriever = {
    buildContext: boom,
    getRelevant: boom,
  } as unknown as MemoryRetriever;
  return new MemoryManager(memoryService, extractor, retriever);
}

describe('MessagesService (Property: chat resilience when memory fails)', () => {
  it('still produces a V1 reply with empty memory context when memory throws', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
        async (content) => {
          const supabase = new FakeSupabase();
          const capture: { last?: AIRequest } = {};
          const service = new MessagesService(
            supabase as unknown as SupabaseService,
            stubConversations(),
            stubAI(capture),
            stubUsers(),
            throwingMemoryManager(),
          );

          const chunks: AIChunk[] = [];
          // The pipeline must not throw despite the failing memory subsystem.
          for await (const chunk of service.sendAndStream(
            USER_ID,
            CONV_ID,
            content,
          )) {
            chunks.push(chunk);
          }

          // A reply is produced (Requirements 11.1, 13.1).
          const text = chunks
            .filter((c) => c.type === 'chunk')
            .map((c) => (c as { content: string }).content)
            .join('');
          expect(text).toBe('v1-reply');
          expect(chunks.some((c) => c.type === 'error')).toBe(false);

          // Memory context was empty: no system message was injected
          // (Requirement 11.1).
          const systemMessages = (capture.last?.messages ?? []).filter(
            (m) => m.role === 'system',
          );
          expect(systemMessages).toHaveLength(0);

          // Both the user message and the assistant reply were persisted
          // (V1 behavior preserved, Requirement 13.1).
          expect(
            supabase.stored.filter((m) => m.role === 'user'),
          ).toHaveLength(1);
          expect(
            supabase.stored.filter((m) => m.role === 'assistant'),
          ).toHaveLength(1);
        },
      ),
      { numRuns: 100 },
    );
  });
});
