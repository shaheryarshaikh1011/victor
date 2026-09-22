import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth';
import { UsersModule } from './users';
import { ConversationsModule } from './conversations';

/**
 * Root application module. Additional feature modules (messages, ai) are added
 * in subsequent tasks.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    AuthModule,
    UsersModule,
    ConversationsModule,
  ],
})
export class AppModule {}
