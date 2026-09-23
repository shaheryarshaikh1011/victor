/**
 * VICTOR V2 memory domain types.
 *
 * These model the persisted `memories` records and the inputs/options used by
 * the memory service and repository. `Memory` is the internal domain shape and
 * includes the embedding; `MemoryView` is the API-safe projection returned to
 * clients and never exposes the embedding or other internal columns
 * (Requirement 3.3).
 */

/** The kind of remembered information (Requirement 1.2). */
export type MemoryType =
  | 'explicit'
  | 'preference'
  | 'personal_fact'
  | 'episodic'
  | 'behavioral';

/** How a memory was captured. */
export type MemorySource = 'user_explicit' | 'auto_extracted';

/** Coarse retention/ranking signal (Requirement 1.3). */
export type Importance = 'low' | 'medium' | 'high';

/** Lifecycle status; superseded memories are soft-invalidated (Requirement 7.2). */
export type MemoryStatus = 'active' | 'superseded';

/**
 * Internal domain representation of a persisted memory. Includes the embedding
 * and is never returned directly from the API.
 */
export interface Memory {
  id: string;
  userId: string;
  content: string;
  memoryType: MemoryType;
  source: MemorySource;
  sourceConversationId: string | null;
  importance: Importance;
  confidence: number;
  status: MemoryStatus;
  embedding: number[] | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string;
}

/**
 * API-safe projection of a memory (Requirement 3.3). Excludes the embedding
 * and any other internal-only fields.
 */
export interface MemoryView {
  id: string;
  content: string;
  memoryType: MemoryType;
  source: MemorySource;
  sourceConversationId: string | null;
  importance: Importance;
  confidence: number;
  status: MemoryStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string;
}

/** Input for creating a memory. Ownership is supplied by the caller context. */
export interface CreateMemoryInput {
  content: string;
  memoryType: MemoryType;
  source: MemorySource;
  sourceConversationId?: string | null;
  /** Optional; when omitted a default is assigned by type/source. */
  importance?: Importance;
  /** Optional; when omitted a default is assigned by type/source. */
  confidence?: number;
  metadata?: Record<string, unknown>;
}

/** Fields that may be updated on an owned memory. */
export interface UpdateMemoryInput {
  content?: string;
  memoryType?: MemoryType;
  importance?: Importance;
  confidence?: number;
  status?: MemoryStatus;
  metadata?: Record<string, unknown>;
}

/** Filter/search options for listing a user's memories (Requirement 3.2). */
export interface MemorySearchOptions {
  memoryType?: MemoryType;
  status?: MemoryStatus;
  /** Case-insensitive text match against content. */
  search?: string;
}
