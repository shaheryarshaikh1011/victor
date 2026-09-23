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
    return this.toEventStream((signal) =>
      this.messages.sendAndStream(userId, conversationId, dto.content, signal),
    );
  }

  @Post(':messageId/regenerate')
  @Sse()
  regenerate(
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) conversationId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ): Observable<MessageEvent> {
    return this.toEventStream((signal) =>
      this.messages.regenerate(userId, conversationId, messageId, signal),
    );
  }

  /**
   * Adapts an async iterable of chunks into an Observable of SSE events,
   * preserving delivery order (Requirements 7.1, 7.2). When the client
   * disconnects, the abort signal cancels the upstream AI request so no more
   * tokens are generated (or billed) for a reply nobody will read.
   */
  private toEventStream(
    open: (signal: AbortSignal) => AsyncIterable<AIChunk>,
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const controller = new AbortController();

      (async () => {
        try {
          for await (const chunk of open(controller.signal)) {
            if (controller.signal.aborted) {
              // Keep draining so the service can persist the partial reply.
              continue;
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
        controller.abort();
      };
    });
  }
}
