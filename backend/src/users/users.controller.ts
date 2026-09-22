import {
  Body,
  Controller,
  Get,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { CurrentUserId } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { Profile, UserSettings } from '../shared';
import { UpdateSettingsDto } from './dto/settings.dto';
import { UsersService } from './users.service';

/**
 * Profile and settings endpoints for the authenticated caller.
 *
 * Every route is guarded so the Authenticated_User_Id is derived from the
 * verified session (Requirement 1.5) and each operation is scoped to that id
 * (Requirements 2.1, 2.2, 2.3, 2.4).
 */
@Controller('users')
@UseGuards(SupabaseAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getProfile(@CurrentUserId() userId: string): Promise<Profile> {
    return this.usersService.getProfile(userId);
  }

  @Get('me/settings')
  getSettings(@CurrentUserId() userId: string): Promise<UserSettings> {
    return this.usersService.getSettings(userId);
  }

  @Patch('me/settings')
  updateSettings(
    @CurrentUserId() userId: string,
    @Body() dto: UpdateSettingsDto,
  ): Promise<UserSettings> {
    return this.usersService.updateSettings(userId, dto);
  }
}
