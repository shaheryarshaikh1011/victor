import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUserId } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import {
  CreateMemoryDto,
  ListMemoryQueryDto,
  UpdateMemoryDto,
} from './dto/memory.dto';
import { MemoryService } from './memory.service';
import { MemoryView } from './memory.types';

/**
 * Memory endpoints for the authenticated caller (Requirement 3).
 *
 * Every route is guarded so the Authenticated_User_Id is derived from the
 * verified session (Requirement 3.4) and the user id is never accepted from the
 * request body. Reads and mutations are scoped to that id by the service layer,
 * which returns API-safe `MemoryView` projections without embeddings
 * (Requirement 3.3).
 */
@Controller('memory')
@UseGuards(SupabaseAuthGuard)
export class MemoryController {
  constructor(private readonly memoryService: MemoryService) {}

  /**
   * List the caller's memories with optional `memory_type` and `search`
   * filtering (Requirements 3.1, 3.2).
   */
  @Get()
  list(
    @CurrentUserId() userId: string,
    @Query() query: ListMemoryQueryDto,
  ): Promise<MemoryView[]> {
    return this.memoryService.searchMemories(userId, {
      memoryType: query.memory_type,
      search: query.search,
    });
  }

  /** Return a single owned memory (Requirements 3.1, 3.3). */
  @Get(':id')
  get(
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MemoryView> {
    return this.memoryService.getMemory(userId, id);
  }

  /** Create a memory for the caller (Requirements 3.1, 3.2, 3.3). */
  @Post()
  create(
    @CurrentUserId() userId: string,
    @Body() dto: CreateMemoryDto,
  ): Promise<MemoryView> {
    return this.memoryService.createMemory(userId, {
      content: dto.content,
      memoryType: dto.memoryType,
      source: dto.source ?? 'user_explicit',
      sourceConversationId: dto.sourceConversationId ?? null,
      importance: dto.importance,
      confidence: dto.confidence,
      metadata: dto.metadata,
    });
  }

  /** Update an owned memory (Requirements 3.1, 3.3). */
  @Patch(':id')
  update(
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMemoryDto,
  ): Promise<MemoryView> {
    return this.memoryService.updateMemory(userId, id, {
      content: dto.content,
      memoryType: dto.memoryType,
      importance: dto.importance,
      confidence: dto.confidence,
      status: dto.status,
      metadata: dto.metadata,
    });
  }

  /** Delete a single owned memory (Requirement 3.1). */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.memoryService.deleteMemory(userId, id);
  }

  /** Delete all of the caller's memories (Requirement 3.1). */
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteAll(@CurrentUserId() userId: string): Promise<void> {
    return this.memoryService.deleteAllMemories(userId);
  }
}
