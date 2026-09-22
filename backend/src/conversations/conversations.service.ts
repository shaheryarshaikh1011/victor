import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Conversation } from '../shared';
import { SupabaseService } from '../auth/supabase.service';
import { CreateConversationDto } from './dto/conversation.dto';

const DEFAULT_TITLE = 'New Conversation';

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
  constructor(private readonly supabase: SupabaseService) {}

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
      .order('created_at', { ascending: true });

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
      .select('id, user_id, title, created_at, updated_at')
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
  }): Conversation {
    return {
      id: row.id,
      userId: row.user_id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
