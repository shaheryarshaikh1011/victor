import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createRemoteJWKSet, JWTVerifyGetKey, jwtVerify } from 'jose';

/** The verified identity attached to a request. */
export interface VerifiedUser {
  id: string;
}

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
  private readonly logger = new Logger(SupabaseService.name);
  private adminClient!: SupabaseClient;
  private anonClient!: SupabaseClient;
  private jwks!: JWTVerifyGetKey;
  private issuer!: string;

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

    const base = url.replace(/\/+$/, '');
    this.issuer = `${base}/auth/v1`;
    // Cached and refreshed by jose; lets most requests skip a network call.
    this.jwks = createRemoteJWKSet(
      new URL(`${this.issuer}/.well-known/jwks.json`),
    );
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
   * Verifies a bearer access token and returns the associated user id.
   * Returns null when the token is missing or invalid.
   *
   * Tokens signed with the project's asymmetric keys are verified locally
   * against the cached JWKS (no network round trip). Anything that cannot be
   * verified locally — e.g. legacy HS256 tokens, or a JWKS fetch failure — is
   * checked with Supabase Auth as before.
   */
  async getUserFromToken(accessToken: string): Promise<VerifiedUser | null> {
    if (!accessToken) {
      return null;
    }

    try {
      const { payload } = await jwtVerify(accessToken, this.jwks, {
        issuer: this.issuer,
        audience: 'authenticated',
      });
      if (typeof payload.sub === 'string' && payload.sub) {
        return { id: payload.sub };
      }
    } catch (err) {
      const code = (err as { code?: string }).code;
      // Definitive rejections: don't spend a network call on them.
      if (
        code === 'ERR_JWT_EXPIRED' ||
        code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' ||
        code === 'ERR_JWT_CLAIM_VALIDATION_FAILED'
      ) {
        return null;
      }
      this.logger.debug(`Local JWT verification unavailable (${code})`);
    }

    const { data, error } = await this.adminClient.auth.getUser(accessToken);
    if (error || !data.user) {
      return null;
    }
    return { id: data.user.id };
  }

  private requireEnv(key: string): string {
    const value = this.config.get<string>(key);
    if (!value) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
  }
}
