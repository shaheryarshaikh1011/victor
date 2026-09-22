import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUserId } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { Conversation } from '../shared';
import { ConversationsService } from './conversations.service';
import { CreateConversationDto } from './dto/conversation.dto';

/**
 * Conversation endpoints for the authenticated caller.
 *
 * Every route is guarded so the Authenticated_User_Id is derived from the
 * verified session (Requirement 1.5). Access and mutation are scoped to that
 * id, returning a forbidden error for non-owned conversations (Requirements
 * 3.3, 3.5).
 */
@Controller('conversations')
@UseGuards(SupabaseAuthGuard)
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Post()
  create(
    @CurrentUserId() userId: string,
    @Body() dto: CreateConversationDto,
  ): Promise<Conversation> {
    return this.conversationsService.create(userId, dto);
  }

  @Get()
  list(@CurrentUserId() userId: string): Promise<Conversation[]> {
    return this.conversationsService.list(userId);
  }

  @Get(':id')
  get(
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Conversation> {
    return this.conversationsService.getOwned(userId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.conversationsService.delete(userId, id);
  }
}
