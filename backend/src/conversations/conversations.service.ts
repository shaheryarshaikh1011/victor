import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Conversation } from '../shared';
import { SupabaseService } from '../auth/supabase.service';
import { AIService } from '../ai/ai.service';
import { CreateConversationDto } from './dto/conversation.dto';

export const DEFAULT_TITLE = 'New Conversation';

const TITLE_MAX_LENGTH = 60;

/**
 * Owns conversation persistence scoped to the Authenticated_User_Id.
 *
 * - `create` persists a conversation owned by the caller (Requirement 3.1).
 * - `list` returns only the caller's conversations (Requirement 3.2).
 * - `getOwned` returns a conversation only when the caller owns it, otherwise
 *   rejects with a forbidden error (Requirement 3.3).
 * - `delete` removes an owned conversation and cascades to its messages via the
 *   database FK (Requirement 3.4); deleting a non-owned conversation is
 *   rejected and the conversation is preserved (Requirement 3.5).
 */
@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly ai: AIService,
  ) {}

  async create(
    userId: string,
    dto: CreateConversationDto,
  ): Promise<Conversation> {
    const now = new Date().toISOString();
    const { data, error } = await this.supabase.admin
      .from('conversations')
      .insert({
        user_id: userId,
        title: dto.title ?? DEFAULT_TITLE,
        created_at: now,
        updated_at: now,
      })
      .select('id, user_id, title, created_at, updated_at')
      .single();

    if (error || !data) {
      throw new BadRequestException('Failed to create conversation');
    }

    return this.toConversation(data);
  }

  async list(userId: string): Promise<Conversation[]> {
    const { data, error } = await this.supabase.admin
      .from('conversations')
      .select('id, user_id, title, created_at, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

    if (error) {
      throw new BadRequestException('Failed to list conversations');
    }

    return (data ?? []).map((row) => this.toConversation(row));
  }

  async getOwned(
    userId: string,
    conversationId: string,
  ): Promise<Conversation> {
    return this.assertOwned(userId, conversationId);
  }

  /** Marks a conversation as active now so it sorts first in the list. */
  async touch(conversationId: string): Promise<void> {
    const { error } = await this.supabase.admin
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationId);
    if (error) {
      this.logger.warn(`touch failed: ${error.message}`);
    }
  }

  /** Stores the rolling summary and the newest message time it covers. */
  async saveSummary(
    conversationId: string,
    summary: string,
    summaryUpto: string,
  ): Promise<void> {
    const { error } = await this.supabase.admin
      .from('conversations')
      .update({ summary, summary_upto: summaryUpto })
      .eq('id', conversationId);
    if (error) {
      throw new BadRequestException('Failed to save conversation summary');
    }
  }

  /**
   * Replaces the default title with a short one generated from the first user
   * message. Best-effort: failures leave the default title in place.
   */
  async autoTitle(
    conversation: Conversation,
    firstUserText: string,
  ): Promise<void> {
    if (conversation.title !== DEFAULT_TITLE) {
      return;
    }
    try {
      const raw = await this.ai.generateUtility(
        conversation.userId,
        'title',
        'Write a short title (at most 6 words) for a conversation that ' +
          'starts with the user message below. Output only the title, no ' +
          'quotes or trailing punctuation.',
        firstUserText.slice(0, 1000),
      );
      const title = raw
        .split('\n')[0]
        .replace(/^["'“”\s]+|["'“”.\s]+$/g, '')
        .slice(0, TITLE_MAX_LENGTH);
      if (!title) {
        return;
      }
      await this.supabase.admin
        .from('conversations')
        .update({ title })
        .eq('id', conversation.id)
        .eq('title', DEFAULT_TITLE);
    } catch (err) {
      this.logger.warn(`autoTitle failed: ${(err as Error).message}`);
    }
  }

  async delete(userId: string, conversationId: string): Promise<void> {
    // Enforce ownership before mutating; non-owned deletes are rejected and the
    // conversation is preserved (Requirement 3.5).
    await this.assertOwned(userId, conversationId);

    // The messages FK uses ON DELETE CASCADE, so removing the conversation
    // removes its messages as well (Requirement 3.4).
    const { error } = await this.supabase.admin
      .from('conversations')
      .delete()
      .eq('id', conversationId)
      .eq('user_id', userId);

    if (error) {
      throw new BadRequestException('Failed to delete conversation');
    }
  }

  /**
   * Reusable ownership check. Loads the conversation and confirms it belongs to
   * the caller. Returns a forbidden error for conversations owned by another
   * user (Requirements 3.3, 3.5) and a not-found error when no such
   * conversation exists.
   */
  private async assertOwned(
    userId: string,
    conversationId: string,
  ): Promise<Conversation> {
    const { data, error } = await this.supabase.admin
      .from('conversations')
      .select('id, user_id, title, created_at, updated_at, summary, summary_upto')
      .eq('id', conversationId)
      .maybeSingle();

    if (error) {
      throw new BadRequestException('Failed to read conversation');
    }

    if (!data) {
      throw new NotFoundException('Conversation not found');
    }

    if (data.user_id !== userId) {
      throw new ForbiddenException('Conversation is not owned by the caller');
    }

    return this.toConversation(data);
  }

  private toConversation(row: {
    id: string;
    user_id: string;
    title: string;
    created_at: string;
    updated_at: string;
    summary?: string | null;
    summary_upto?: string | null;
  }): Conversation {
    const conversation: Conversation = {
      id: row.id,
      userId: row.user_id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
    if (row.summary !== undefined) {
      conversation.summary = row.summary;
      conversation.summaryUpto = row.summary_upto ?? null;
    }
    return conversation;
  }
}
