import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Profile } from '../shared';
import { LoginDto, SignupDto } from './dto/auth.dto';
import { SupabaseService } from './supabase.service';

/** Result of a successful login: the session token for the Web_Client. */
export interface SessionResult {
  accessToken: string;
  refreshToken: string;
  expiresAt: number | null;
}

/** Result of a successful signup: the created profile. */
export interface SignupResult {
  profile: Profile;
}

/**
 * Handles signup and login against Supabase auth.
 *
 * - Signup creates the auth user and a matching profile row (Requirement 1.1),
 *   returning a conflict when the email already exists (Requirement 1.2).
 * - Login establishes a session and returns a session token to the client
 *   (Requirement 1.3).
 */
@Injectable()
export class AuthService {
  constructor(private readonly supabase: SupabaseService) {}

  async signup(dto: SignupDto): Promise<SignupResult> {
    const { data, error } = await this.supabase.admin.auth.admin.createUser({
      email: dto.email,
      password: dto.password,
      email_confirm: true,
      user_metadata: dto.displayName
        ? { display_name: dto.displayName }
        : undefined,
    });

    if (error || !data.user) {
      if (this.isDuplicateEmailError(error?.message)) {
        throw new ConflictException('Email already registered');
      }
      throw new UnauthorizedException(error?.message ?? 'Signup failed');
    }

    const user = data.user;
    const displayName = dto.displayName ?? null;

    const { data: profileRow, error: profileError } = await this.supabase.admin
      .from('profiles')
      .insert({
        id: user.id,
        email: dto.email,
        display_name: displayName,
      })
      .select('id, email, display_name, created_at')
      .single();

    if (profileError || !profileRow) {
      // Roll back the orphaned auth user so a retry can succeed cleanly.
      await this.supabase.admin.auth.admin.deleteUser(user.id);
      if (this.isDuplicateEmailError(profileError?.message)) {
        throw new ConflictException('Email already registered');
      }
      throw new UnauthorizedException(
        profileError?.message ?? 'Profile creation failed',
      );
    }

    return {
      profile: {
        id: profileRow.id,
        email: profileRow.email,
        displayName: profileRow.display_name,
        createdAt: profileRow.created_at,
      },
    };
  }

  async login(dto: LoginDto): Promise<SessionResult> {
    const { data, error } = await this.supabase.anon.auth.signInWithPassword({
      email: dto.email,
      password: dto.password,
    });

    if (error || !data.session) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at ?? null,
    };
  }

  private isDuplicateEmailError(message?: string | null): boolean {
    if (!message) {
      return false;
    }
    const lowered = message.toLowerCase();
    return (
      lowered.includes('already registered') ||
      lowered.includes('already been registered') ||
      lowered.includes('duplicate') ||
      lowered.includes('unique constraint') ||
      lowered.includes('already exists')
    );
  }
}
