import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AIChunk, AIRequest, Message, MessageRole } from '../shared';
import { SupabaseService } from '../auth/supabase.service';
import { ConversationsService } from '../conversations/conversations.service';
import { AIService } from '../ai/ai.service';
import { UsersService } from '../users/users.service';
import { MemoryManager } from '../memory/services/memory-manager.service';

/**
 * Owns message persistence and reads scoped to the Authenticated_User_Id via
 * the conversation's ownership.
 *
 * - `appendUserMessage` persists a user-role message on an owned conversation
 *   (Requirement 4.1).
 * - `appendAssistantMessage` persists an assistant-role message once the
 *   AI_Service has produced a reply (Requirement 4.2).
 * - `listForConversation` returns an owned conversation's messages ordered by
 *   creation time ascending (Requirement 4.3).
 * - Every operation enforces conversation ownership through the reusable
 *   `ConversationsService.getOwned` check, rejecting non-owned access with a
 *   forbidden error (Requirement 4.4).
 */
@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly conversations: ConversationsService,
    private readonly aiService: AIService,
    private readonly users: UsersService,
    private readonly memory: MemoryManager,
  ) {}

  /**
   * Lists the messages of an owned conversation ordered by creation time in
   * ascending order (Requirements 4.3, 4.4).
   */
  async listForConversation(
    userId: string,
    conversationId: string,
  ): Promise<Message[]> {
    await this.conversations.getOwned(userId, conversationId);
    return this.readMessages(conversationId);
  }

  /**
   * Persists a user-role message on an owned conversation (Requirements 4.1,
   * 4.4).
   */
  async appendUserMessage(
    userId: string,
    conversationId: string,
    content: string,
  ): Promise<Message> {
    await this.conversations.getOwned(userId, conversationId);
    return this.insertMessage(conversationId, 'user', content);
  }

  /**
   * Persists an assistant-role message on a conversation (Requirement 4.2).
   * Ownership has already been enforced by the caller that produced the reply.
   */
  async appendAssistantMessage(
    conversationId: string,
    content: string,
  ): Promise<Message> {
    return this.insertMessage(conversationId, 'assistant', content);
  }

  /**
   * Sends a user message to an owned conversation and streams the assistant
   * reply as an ordered sequence of chunks (Requirement 7.1). The user message
   * is persisted first, the streamed chunks are yielded to the caller in
   * delivery order, and the assistant message is persisted with content equal
   * to the concatenation of those chunks (Requirements 4.2, 7.2).
   */
  async *sendAndStream(
    userId: string,
    conversationId: string,
    content: string,
  ): AsyncIterable<AIChunk> {
    await this.conversations.getOwned(userId, conversationId);
    await this.insertMessage(conversationId, 'user', content);

    // Explicit memory commands (remember/forget/recall) are answered directly
    // without an LLM call: stream the confirmation and persist it as the
    // assistant reply (Requirements 4.1, 4.2, 8.1). Failures fall through to
    // the normal pipeline (Requirement 11.2).
    const handled = await this.memory.handleUserMessage(
      userId,
      conversationId,
      content,
    );
    if (handled.handled && handled.reply) {
      yield { type: 'chunk', content: handled.reply };
      await this.insertMessage(conversationId, 'assistant', handled.reply);
      return;
    }

    const history = await this.readMessages(conversationId);
    yield* this.streamAssistantReply(userId, conversationId, history);
  }

  /**
   * Regenerates the assistant reply for the user message that immediately
   * precedes the given assistant message in the same owned conversation
   * (Requirement 8.4). The prompt history is truncated to end at that preceding
   * user message, and the new reply is streamed and persisted (Requirements
   * 7.1, 7.2).
   */
  async *regenerate(
    userId: string,
    conversationId: string,
    assistantMessageId: string,
  ): AsyncIterable<AIChunk> {
    await this.conversations.getOwned(userId, conversationId);

    const history = await this.readMessages(conversationId);
    const targetIndex = history.findIndex(
      (message) => message.id === assistantMessageId,
    );

    if (targetIndex < 0) {
      throw new NotFoundException('Message not found');
    }

    // Find the user message immediately preceding the assistant message.
    let userIndex = -1;
    for (let i = targetIndex - 1; i >= 0; i -= 1) {
      if (history[i].role === 'user') {
        userIndex = i;
        break;
      }
    }

    if (userIndex < 0) {
      throw new BadRequestException(
        'No preceding user message to regenerate from',
      );
    }

    const promptHistory = history.slice(0, userIndex + 1);
    yield* this.streamAssistantReply(userId, conversationId, promptHistory);
  }

  /**
   * Streams an assistant reply for the given prompt history and persists the
   * assembled content. Chunks are forwarded to the caller in delivery order;
   * when the stream completes without error the concatenated chunk content is
   * persisted as the assistant message (Requirements 7.1, 7.2, 4.2).
   */
  private async *streamAssistantReply(
    userId: string,
    conversationId: string,
    history: Message[],
  ): AsyncIterable<AIChunk> {
    const settings = await this.users.getSettings(userId);

    // Inject relevant memories as a system message ordered before the
    // conversation history (Requirement 6.3). Best-effort: an empty block is
    // returned on any failure so chat proceeds without memory (Requirement
    // 11.1).
    const latestUserText = this.latestUserText(history);
    const memoryContext = latestUserText
      ? await this.memory.buildMemoryContext(userId, latestUserText)
      : '';

    const messages: AIRequest['messages'] = [];
    if (memoryContext) {
      messages.push({ role: 'system', content: memoryContext });
    }
    for (const message of history) {
      messages.push({ role: message.role, content: message.content });
    }

    const request: AIRequest = {
      model: settings.model,
      messages,
    };

    // Debug aid: log the exact prompt sent to the AI (system prompt + memory
    // context + conversation history + current message). Opt-in via
    // LOG_AI_PROMPT since it echoes memory/message content (Requirement 12.1).
    if (process.env.LOG_AI_PROMPT === 'true') {
      const rendered = messages
        .map((m, i) => `  [${i}] ${m.role}: ${m.content}`)
        .join('\n');
      this.logger.debug(
        `AI prompt (provider=${settings.provider}, model=${settings.model}, ` +
          `messages=${messages.length}):\n${rendered}`,
      );
    }

    let assembled = '';
    let errored = false;

    for await (const chunk of this.aiService.stream(request, settings)) {
      if (chunk.type === 'error') {
        errored = true;
        yield chunk;
        return;
      }
      assembled += chunk.content;
      yield chunk;
    }

    if (!errored) {
      await this.insertMessage(conversationId, 'assistant', assembled);
      // Fire-and-forget auto-extraction off the response path; never blocks or
      // breaks the reply (Requirements 5.x, 11.2).
      if (latestUserText) {
        void this.memory.extractFromExchange(
          userId,
          conversationId,
          latestUserText,
          assembled,
        );
      }
    }
  }

  /** Returns the content of the most recent user message, or empty string. */
  private latestUserText(history: Message[]): string {
    for (let i = history.length - 1; i >= 0; i -= 1) {
      if (history[i].role === 'user') {
        return history[i].content;
      }
    }
    return '';
  }

  /**
   * Reads the persisted messages for a conversation ordered ascending by
   * creation time (Requirement 4.3).
   */
  private async readMessages(conversationId: string): Promise<Message[]> {
    const { data, error } = await this.supabase.admin
      .from('messages')
      .select('id, conversation_id, role, content, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new BadRequestException('Failed to list messages');
    }

    return (data ?? []).map((row) => this.toMessage(row));
  }

  private async insertMessage(
    conversationId: string,
    role: MessageRole,
    content: string,
  ): Promise<Message> {
    const { data, error } = await this.supabase.admin
      .from('messages')
      .insert({
        conversation_id: conversationId,
        role,
        content,
        created_at: new Date().toISOString(),
      })
      .select('id, conversation_id, role, content, created_at')
      .single();

    if (error || !data) {
      throw new BadRequestException('Failed to persist message');
    }

    return this.toMessage(data);
  }

  private toMessage(row: {
    id: string;
    conversation_id: string;
    role: MessageRole;
    content: string;
    created_at: string;
  }): Message {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role,
      content: row.content,
      createdAt: row.created_at,
    };
  }
}
