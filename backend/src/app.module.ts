import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth';
import { UsersModule } from './users';
import { ConversationsModule } from './conversations';
import { MessagesModule } from './messages';
import { AIModule } from './ai';

/**
 * Root application module wiring the auth, users, conversations, ai, and
 * messages feature modules.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    AuthModule,
    UsersModule,
    ConversationsModule,
    AIModule,
    MessagesModule,
  ],
})
export class AppModule {}
