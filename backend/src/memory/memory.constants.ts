/**
 * VICTOR V2 memory tuning constants.
 *
 * Single source of truth for retrieval/dedup thresholds, context bounds, and
 * the importance/confidence defaults assigned by memory type and source
 * (Requirements 1.3, 1.4, 3.3, 12.2). Keeping these here means scoring and
 * gating are documented rather than arbitrary.
 */

import type { Importance, MemorySource, MemoryType } from './memory.types';

/** Number of memories returned by a retrieval query. */
export const TOP_K = 8;

/** Minimum cosine similarity for a memory to be considered relevant. */
export const MIN_SIMILARITY = 0.75;

/** Cosine similarity at/above which a new memory reinforces an existing one. */
export const DEDUP_SIMILARITY = 0.92;

/** Minimum extractor confidence before a behavioral memory is auto-stored. */
export const BEHAVIORAL_MIN_CONFIDENCE = 0.8;

/** Maximum number of memories injected into a prompt's context block. */
export const MAX_CONTEXT_MEMORIES = 8;

/** Maximum character length of the injected memory context block. */
export const MAX_CONTEXT_CHARS = 1200;

/** Bounded size of the embedding LRU cache. */
export const EMBED_CACHE_SIZE = 256;

/** Messages shorter than this skip embedding/retrieval entirely. */
export const MIN_MESSAGE_LEN_FOR_RETRIEVAL = 8;

/**
 * Weights for the combined retrieval ranking score. Mirrors the SQL in
 * `match_memories`: 0.70*similarity + 0.20*importance + 0.10*recency.
 */
export const RANKING_WEIGHTS = {
  similarity: 0.7,
  importance: 0.2,
  recency: 0.1,
} as const;

/**
 * Default importance by memory type and source (Requirement 1.3). Explicit
 * user statements are high; automatically extracted facts are medium; low is
 * reserved for weak behavioral signals.
 */
export function defaultImportance(
  type: MemoryType,
  source: MemorySource,
): Importance {
  if (source === 'user_explicit') {
    return 'high';
  }
  if (type === 'behavioral') {
    return 'low';
  }
  return 'medium';
}

/**
 * Default confidence by memory type and source (Requirement 1.4). Explicit
 * user instructions are high; automatic inferences are lower.
 */
export function defaultConfidence(
  type: MemoryType,
  source: MemorySource,
): number {
  if (source === 'user_explicit') {
    return 0.95;
  }
  if (type === 'behavioral') {
    return BEHAVIORAL_MIN_CONFIDENCE;
  }
  return 0.6;
}
