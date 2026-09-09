import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

/**
 * Root application module. Feature modules (auth, users, conversations,
 * messages, ai) are added in subsequent tasks.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
  ],
})
export class AppModule {}
