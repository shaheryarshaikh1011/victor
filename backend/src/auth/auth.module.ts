import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SupabaseAuthGuard } from './supabase-auth.guard';
import { SupabaseService } from './supabase.service';

/**
 * AuthModule owns session verification and the signup/login flows.
 *
 * It is global so `SupabaseService` and `SupabaseAuthGuard` are available to
 * every feature module (users, conversations, messages, ai) without repeated
 * imports.
 */
@Global()
@Module({
  controllers: [AuthController],
  providers: [SupabaseService, AuthService, SupabaseAuthGuard],
  exports: [SupabaseService, AuthService, SupabaseAuthGuard],
})
export class AuthModule {}
