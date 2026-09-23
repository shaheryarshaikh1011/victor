import { Module } from '@nestjs/common';
import { AIModule } from '../ai/ai.module';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

/**
 * ConversationsModule exposes create/list/get/delete for the authenticated
 * user's conversations. It relies on the global AuthModule for
 * `SupabaseService` and `SupabaseAuthGuard`, and exports `ConversationsService`
 * so the MessagesModule can reuse the ownership check.
 */
@Module({
  imports: [AIModule],
  controllers: [ConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
