import { Module } from '@nestjs/common';
import { AIModule } from '../ai/ai.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { UsersModule } from '../users/users.module';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

/**
 * MessagesModule exposes message reads and the streaming send/regenerate
 * endpoints for the authenticated user's owned conversations. It reuses
 * `ConversationsService` for ownership checks, `UsersService` for the caller's
 * provider/model settings, and `AIService` for generation.
 */
@Module({
  imports: [ConversationsModule, UsersModule, AIModule],
  controllers: [MessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
