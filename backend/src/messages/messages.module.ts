import { Module } from '@nestjs/common';
import { AIModule } from '../ai/ai.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { MemoryModule } from '../memory/memory.module';
import { UsersModule } from '../users/users.module';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

/**
 * MessagesModule exposes message reads and the streaming send/regenerate
 * endpoints for the authenticated user's owned conversations. It reuses
 * `ConversationsService` for ownership checks, `UsersService` for the caller's
 * provider/model settings, `AIService` for generation, and `MemoryManager`
 * (via `MemoryModule`) to handle memory commands, inject memory context, and
 * run auto-extraction (Requirements 4.x, 6.3).
 */
@Module({
  imports: [ConversationsModule, UsersModule, AIModule, MemoryModule],
  controllers: [MessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
