import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient, User } from '@supabase/supabase-js';

/**
 * Wraps the Supabase clients used by the Backend_API.
 *
 * - The admin client uses the service-role key (BACKEND ONLY) for privileged
 *   operations such as creating auth users and reading/writing any row.
 * - Token verification derives the Authenticated_User_Id from a verified
 *   session, so it is never taken from the request body (Requirement 1.5).
 */
@Injectable()
export class SupabaseService implements OnModuleInit {
  private adminClient!: SupabaseClient;
  private anonClient!: SupabaseClient;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const url = this.requireEnv('SUPABASE_URL');
    const serviceRoleKey = this.requireEnv('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = this.requireEnv('SUPABASE_ANON_KEY');

    this.adminClient = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    this.anonClient = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  /** Privileged client (service-role). Never expose results containing keys. */
  get admin(): SupabaseClient {
    return this.adminClient;
  }

  /** Public/anon client for auth flows (signup/login). */
  get anon(): SupabaseClient {
    return this.anonClient;
  }

  /**
   * Verifies a bearer access token and returns the associated user.
   * Returns null when the token is missing or invalid.
   */
  async getUserFromToken(accessToken: string): Promise<User | null> {
    if (!accessToken) {
      return null;
    }
    const { data, error } = await this.adminClient.auth.getUser(accessToken);
    if (error || !data.user) {
      return null;
    }
    return data.user;
  }

  private requireEnv(key: string): string {
    const value = this.config.get<string>(key);
    if (!value) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
  }
}
