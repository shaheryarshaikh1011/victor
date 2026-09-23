import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth';
import { UsersModule } from './users';
import { ConversationsModule } from './conversations';
import { MessagesModule } from './messages';
import { AIModule } from './ai';
import { EmbeddingsModule } from './embeddings';
import { MemoryModule } from './memory';
import { AllExceptionsFilter } from './shared';

/**
 * Root application module wiring the auth, users, conversations, ai, and
 * messages feature modules.
 *
 * The ThrottlerModule provides the per-user Rate_Limit backing store; the
 * limit is applied on AI/message endpoints via UserThrottlerGuard
 * (Requirement 9.2). The global AllExceptionsFilter masks internal errors and
 * logs them (Requirement 9.3).
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ThrottlerModule.forRoot([
      {
        ttl:
          (process.env.RATE_LIMIT_TTL_SECONDS
            ? Number(process.env.RATE_LIMIT_TTL_SECONDS)
            : 60) * 1000,
        limit: process.env.RATE_LIMIT_MAX
          ? Number(process.env.RATE_LIMIT_MAX)
          : 30,
      },
    ]),
    AuthModule,
    UsersModule,
    ConversationsModule,
    AIModule,
    EmbeddingsModule,
    MemoryModule,
    MessagesModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule {}
