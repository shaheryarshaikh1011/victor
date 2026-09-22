import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
  isSupportedModel,
  Profile,
  UserSettings,
} from '../shared';
import { SupabaseService } from '../auth/supabase.service';
import { UpdateSettingsDto } from './dto/settings.dto';

/**
 * Owns profile reads and provider/model settings for the Authenticated_User_Id.
 *
 * - `getProfile` returns the profile matching the caller (Requirement 2.1).
 * - `getSettings` returns the persisted settings, falling back to defaults when
 *   none exist yet (Requirement 2.4).
 * - `updateSettings` validates the (provider, model) pair against the
 *   allow-list before persisting; unsupported pairs are rejected and existing
 *   settings are left unchanged (Requirements 2.2, 2.3).
 */
@Injectable()
export class UsersService {
  constructor(private readonly supabase: SupabaseService) {}

  async getProfile(userId: string): Promise<Profile> {
    const { data, error } = await this.supabase.admin
      .from('profiles')
      .select('id, email, display_name, created_at')
      .eq('id', userId)
      .single();

    if (error || !data) {
      throw new NotFoundException('Profile not found');
    }

    return {
      id: data.id,
      email: data.email,
      displayName: data.display_name,
      createdAt: data.created_at,
    };
  }

  async getSettings(userId: string): Promise<UserSettings> {
    const { data, error } = await this.supabase.admin
      .from('user_settings')
      .select('user_id, provider, model, updated_at')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new BadRequestException('Failed to read settings');
    }

    if (!data) {
      // No explicit settings yet: report the defaults for the caller.
      return {
        userId,
        provider: DEFAULT_PROVIDER,
        model: DEFAULT_MODEL,
        updatedAt: new Date(0).toISOString(),
      };
    }

    return {
      userId: data.user_id,
      provider: data.provider,
      model: data.model,
      updatedAt: data.updated_at,
    };
  }

  async updateSettings(
    userId: string,
    dto: UpdateSettingsDto,
  ): Promise<UserSettings> {
    // Reject any (provider, model) pair outside the allow-list without
    // touching persisted state (Requirement 2.3).
    if (!isSupportedModel(dto.provider, dto.model)) {
      throw new BadRequestException(
        `Unsupported provider/model: ${dto.provider}/${dto.model}`,
      );
    }

    const updatedAt = new Date().toISOString();
    const { data, error } = await this.supabase.admin
      .from('user_settings')
      .upsert(
        {
          user_id: userId,
          provider: dto.provider,
          model: dto.model,
          updated_at: updatedAt,
        },
        { onConflict: 'user_id' },
      )
      .select('user_id, provider, model, updated_at')
      .single();

    if (error || !data) {
      throw new BadRequestException('Failed to persist settings');
    }

    return {
      userId: data.user_id,
      provider: data.provider,
      model: data.model,
      updatedAt: data.updated_at,
    };
  }
}
