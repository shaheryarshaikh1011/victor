import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * UsersModule exposes profile reads and provider/model settings for the
 * authenticated user. It relies on the global AuthModule for `SupabaseService`
 * and `SupabaseAuthGuard`.
 */
@Module({
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
