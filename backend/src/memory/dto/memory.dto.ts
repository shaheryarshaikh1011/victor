import {
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type {
  Importance,
  MemorySource,
  MemoryStatus,
  MemoryType,
} from '../memory.types';

/** Allowed memory type values for validation. */
const MEMORY_TYPES: MemoryType[] = [
  'explicit',
  'preference',
  'personal_fact',
  'episodic',
  'behavioral',
];

/** Allowed memory source values for validation. */
const MEMORY_SOURCES: MemorySource[] = ['user_explicit', 'auto_extracted'];

/** Allowed importance values for validation. */
const IMPORTANCE_VALUES: Importance[] = ['low', 'medium', 'high'];

/** Allowed status values for validation. */
const STATUS_VALUES: MemoryStatus[] = ['active', 'superseded'];

/**
 * Body for creating a memory (Requirements 3.2, 3.3).
 *
 * The ownership user id is never accepted from the body — it is derived from
 * the verified session via `@CurrentUserId()`. Importance and confidence are
 * optional; when omitted the service assigns defaults by type/source.
 */
export class CreateMemoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content!: string;

  @IsIn(MEMORY_TYPES)
  memoryType!: MemoryType;

  @IsOptional()
  @IsIn(MEMORY_SOURCES)
  source?: MemorySource;

  @IsOptional()
  @IsUUID()
  sourceConversationId?: string | null;

  @IsOptional()
  @IsIn(IMPORTANCE_VALUES)
  importance?: Importance;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

/**
 * Body for updating an owned memory (Requirements 3.2, 3.3). All fields are
 * optional; the user id is never accepted from the body.
 */
export class UpdateMemoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content?: string;

  @IsOptional()
  @IsIn(MEMORY_TYPES)
  memoryType?: MemoryType;

  @IsOptional()
  @IsIn(IMPORTANCE_VALUES)
  importance?: Importance;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;

  @IsOptional()
  @IsIn(STATUS_VALUES)
  status?: MemoryStatus;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

/**
 * Query parameters for listing memories (Requirement 3.2). Supports optional
 * filtering by `memory_type` and an optional text `search` query.
 */
export class ListMemoryQueryDto {
  @IsOptional()
  @IsIn(MEMORY_TYPES)
  memory_type?: MemoryType;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}
