import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AIChunk,
  Conversation,
  Message,
  MessageRole,
  UserSettings,
} from '../shared';
import { SupabaseService } from '../auth/supabase.service';
import { ConversationsService } from '../conversations/conversations.service';
import { AIService } from '../ai/ai.service';
import { PromptBuilder } from '../ai/prompt-builder';
import { UsersService } from '../users/users.service';
import { MemoryManager } from '../memory/services/memory-manager.service';
import { ConversationSummarizer } from './conversation-summarizer.service';

/** Chunks the chat pipeline streams to the client. */
type ReplyChunk = Exclude<AIChunk, { type: 'usage' }>;

const MESSAGE_COLUMNS = 'id, conversation_id, role, content, created_at';

/** Everything needed to generate and persist one assistant reply. */
interface ReplyContext {
  userId: string;
  conversation: Conversation;
  settings: UserSettings;
  memoryContext: string;
  /** Summary covering turns older than `history`, or null. */
  summary: string | null;
  /** Prompt turns, oldest first, ending with the user message to answer. */
  history: Message[];
  /** When regenerating, the assistant message to overwrite. */
  replaceMessageId?: string;
  signal?: AbortSignal;
}

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
    private readonly prompt: PromptBuilder,
    private readonly summarizer: ConversationSummarizer,
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
   *
   * Everything the prompt needs (history, settings, memory context) is loaded
   * concurrently with persisting the user message to keep time-to-first-token
   * low.
   */
  async *sendAndStream(
    userId: string,
    conversationId: string,
    content: string,
    signal?: AbortSignal,
  ): AsyncIterable<ReplyChunk> {
    const conversation = await this.conversations.getOwned(
      userId,
      conversationId,
    );

    // Explicit memory commands (remember/forget/recall) are answered directly
    // without an LLM call: stream the confirmation and persist it as the
    // assistant reply (Requirements 4.1, 4.2, 8.1). Failures fall through to
    // the normal pipeline (Requirement 11.2).
    if (this.memory.isCommand(content)) {
      await this.insertMessage(conversationId, 'user', content);
      const handled = await this.memory.handleUserMessage(
        userId,
        conversationId,
        content,
      );
      if (handled.handled && handled.reply) {
        yield { type: 'chunk', content: handled.reply };
        await this.insertMessage(conversationId, 'assistant', handled.reply);
        void this.conversations.touch(conversationId);
        return;
      }
      const [history, settings, memoryContext] = await Promise.all([
        this.readMessages(conversationId, conversation.summaryUpto),
        this.users.getSettings(userId),
        this.memory.buildMemoryContext(userId, content),
      ]);
      yield* this.streamAssistantReply({
        userId,
        conversation,
        settings,
        memoryContext,
        summary: conversation.summary ?? null,
        history,
        signal,
      });
      return;
    }

    const [userMessage, previous, settings, memoryContext] = await Promise.all(
      [
        this.insertMessage(conversationId, 'user', content),
        this.readMessages(conversationId, conversation.summaryUpto),
        this.users.getSettings(userId),
        this.memory.buildMemoryContext(userId, content),
      ],
    );

    // The concurrent read may or may not include the new user message.
    const earlier = previous.filter((m) => m.id !== userMessage.id);
    if (earlier.length === 0 && !conversation.summary) {
      void this.conversations.autoTitle(conversation, content);
    }

    yield* this.streamAssistantReply({
      userId,
      conversation,
      settings,
      memoryContext,
      summary: conversation.summary ?? null,
      history: [...earlier, userMessage],
      signal,
    });
  }

  /**
   * Regenerates the assistant reply for the user message that immediately
   * precedes the given assistant message in the same owned conversation
   * (Requirement 8.4). The prompt history is truncated to end at that preceding
   * user message, and the new reply is streamed and replaces the old one in
   * place (Requirements 7.1, 7.2).
   */
  async *regenerate(
    userId: string,
    conversationId: string,
    assistantMessageId: string,
    signal?: AbortSignal,
  ): AsyncIterable<ReplyChunk> {
    const conversation = await this.conversations.getOwned(
      userId,
      conversationId,
    );

    const [history, settings] = await Promise.all([
      this.readMessages(conversationId),
      this.users.getSettings(userId),
    ]);
    const targetIndex = history.findIndex(
      (message) =>
        message.id === assistantMessageId && message.role === 'assistant',
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

    let promptHistory = history.slice(0, userIndex + 1);
    // The summary only applies when it covers nothing after this user
    // message; otherwise it would leak later turns into the regenerated reply.
    const summaryUpto = conversation.summaryUpto;
    const useSummary =
      !!conversation.summary &&
      !!summaryUpto &&
      history[userIndex].createdAt > summaryUpto;
    if (useSummary) {
      promptHistory = promptHistory.filter((m) => m.createdAt > summaryUpto);
    }

    const memoryContext = await this.memory.buildMemoryContext(
      userId,
      history[userIndex].content,
    );

    yield* this.streamAssistantReply({
      userId,
      conversation,
      settings,
      memoryContext,
      summary: useSummary ? (conversation.summary ?? null) : null,
      history: promptHistory,
      replaceMessageId: assistantMessageId,
      signal,
    });
  }

  /**
   * Streams an assistant reply for the given prompt and persists the assembled
   * content. Chunks are forwarded to the caller in delivery order; when the
   * stream completes without error the concatenated chunk content is persisted
   * as the assistant message (Requirements 7.1, 7.2, 4.2). Memory extraction,
   * summarization and the conversation timestamp run afterwards off the
   * response path.
   */
  private async *streamAssistantReply(
    ctx: ReplyContext,
  ): AsyncIterable<ReplyChunk> {
    const { userId, conversation, settings, history } = ctx;

    const messages = this.prompt.build({
      model: settings.model,
      memoryContext: ctx.memoryContext,
      summary: ctx.summary,
      history,
    });

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
    for await (const chunk of this.aiService.stream(
      { model: settings.model, messages, signal: ctx.signal },
      settings,
    )) {
      if (chunk.type === 'error') {
        yield chunk;
        return;
      }
      assembled += chunk.content;
      yield chunk;
    }

    if (!assembled) {
      // Aborted before any content: nothing worth persisting.
      return;
    }

    if (ctx.replaceMessageId) {
      await this.updateMessage(ctx.replaceMessageId, assembled);
    } else {
      await this.insertMessage(conversation.id, 'assistant', assembled);
    }
    void this.conversations.touch(conversation.id);

    // Fire-and-forget background work; never blocks or breaks the reply
    // (Requirements 5.x, 11.2).
    const latestUserText = this.latestUserText(history);
    if (latestUserText && !ctx.replaceMessageId) {
      void this.memory.extractFromExchange(
        userId,
        conversation.id,
        latestUserText,
        assembled,
      );
    }
    if (!ctx.replaceMessageId) {
      void this.summarizer.maybeSummarize(conversation, [
        ...history,
        {
          id: '',
          conversationId: conversation.id,
          role: 'assistant',
          content: assembled,
          createdAt: new Date().toISOString(),
        },
      ]);
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
   * creation time (Requirement 4.3). With `after`, only messages created after
   * that time are returned (the part not covered by the summary).
   */
  private async readMessages(
    conversationId: string,
    after?: string | null,
  ): Promise<Message[]> {
    let query = this.supabase.admin
      .from('messages')
      .select(MESSAGE_COLUMNS)
      .eq('conversation_id', conversationId);
    if (after) {
      query = query.gt('created_at', after);
    }
    const { data, error } = await query.order('created_at', {
      ascending: true,
    });

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
      .select(MESSAGE_COLUMNS)
      .single();

    if (error || !data) {
      throw new BadRequestException('Failed to persist message');
    }

    return this.toMessage(data);
  }

  /** Overwrites a message's content, keeping its id and position. */
  private async updateMessage(id: string, content: string): Promise<void> {
    const { error } = await this.supabase.admin
      .from('messages')
      .update({ content })
      .eq('id', id);

    if (error) {
      throw new BadRequestException('Failed to persist message');
    }
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
