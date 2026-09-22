import {
  Body,
  Controller,
  Get,
  MessageEvent,
  Param,
  ParseUUIDPipe,
  Post,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { CurrentUserId } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { AIChunk, Message, UserThrottlerGuard } from '../shared';
import { MessagesService } from './messages.service';
import { SendMessageDto } from './dto/message.dto';

/**
 * Message endpoints for a conversation owned by the authenticated caller.
 *
 * Every route is guarded so the Authenticated_User_Id is derived from the
 * verified session (Requirement 1.5) and each operation is scoped to that id
 * through the conversation's ownership (Requirement 4.4).
 *
 * The send and regenerate routes stream the assistant reply as Server-Sent
 * Events, emitting one event per {@link AIChunk} in delivery order
 * (Requirements 7.1, 7.2, 8.4).
 */
@Controller('conversations/:id/messages')
@UseGuards(SupabaseAuthGuard, UserThrottlerGuard)
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get()
  list(
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) conversationId: string,
  ): Promise<Message[]> {
    return this.messages.listForConversation(userId, conversationId);
  }

  @Post()
  @Sse()
  send(
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) conversationId: string,
    @Body() dto: SendMessageDto,
  ): Observable<MessageEvent> {
    return this.toEventStream(
      this.messages.sendAndStream(userId, conversationId, dto.content),
    );
  }

  @Post(':messageId/regenerate')
  @Sse()
  regenerate(
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) conversationId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ): Observable<MessageEvent> {
    return this.toEventStream(
      this.messages.regenerate(userId, conversationId, messageId),
    );
  }

  /**
   * Adapts an async iterable of chunks into an Observable of SSE events,
   * preserving delivery order (Requirements 7.1, 7.2).
   */
  private toEventStream(
    chunks: AsyncIterable<AIChunk>,
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let cancelled = false;

      (async () => {
        try {
          for await (const chunk of chunks) {
            if (cancelled) {
              return;
            }
            subscriber.next({ data: chunk });
          }
          subscriber.complete();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Streaming failed';
          subscriber.next({ data: { type: 'error', message } });
          subscriber.complete();
        }
      })();

      return () => {
        cancelled = true;
      };
    });
  }
}
