# Implementation Plan

- [x] 1. Database migration and shared memory types
- [x] 1.1 Create the `memories` table migration
  - Add `backend/supabase/migrations/0002_memory.sql` creating `public.memories` with columns `id`, `user_id` (FK profiles ON DELETE CASCADE), `content`, `memory_type` (check explicit/preference/personal_fact/episodic/behavioral), `source` (check user_explicit/auto_extracted), `source_conversation_id` (FK conversations ON DELETE SET NULL), `importance` (check low/medium/high), `confidence` (real check 0..1), `status` (check active/superseded default active), `embedding vector(768)`, `metadata jsonb default '{}'`, `created_at`, `updated_at`, `last_accessed_at`
  - Create `idx_memories_user_active_type (user_id, status, memory_type)`, IVFFlat cosine `idx_memories_embedding` (lists=100), and GIN trigram `idx_memories_content_trgm` on `content` (enable `pg_trgm`)
  - Add RLS policies restricting all access to `auth.uid() = user_id`
  - _Requirements: 1.1, 1.2, 2.4, 12.2_

- [x] 1.2 Add the `match_memories` SQL function
  - In the same migration, define `match_memories(p_user_id, p_query vector, p_k int, p_min_sim real)` performing user-scoped ANN search, similarity threshold, combined ranking (`0.70*similarity + 0.20*importance_weight + 0.10*recency`), and a `last_accessed_at` bump for the returned rows within the same call (CTE)
  - _Requirements: 2.3, 6.1, 6.4, 12.2_

- [x] 1.3 Define backend memory domain types
  - Create `backend/src/memory/memory.types.ts` with `MemoryType`, `MemorySource`, `Importance`, `MemoryStatus`, `Memory` (domain, includes embedding), `MemoryView` (API-safe, no embedding), `CreateMemoryInput`, `UpdateMemoryInput`, `MemorySearchOptions`
  - Create `backend/src/memory/memory.constants.ts` with `TOP_K=8`, `MIN_SIMILARITY=0.75`, `DEDUP_SIMILARITY=0.92`, `BEHAVIORAL_MIN_CONFIDENCE=0.8`, `MAX_CONTEXT_MEMORIES=8`, `MAX_CONTEXT_CHARS=1200`, `EMBED_CACHE_SIZE=256`, `MIN_MESSAGE_LEN_FOR_RETRIEVAL`, and ranking weights, plus importance/confidence constants by type/source
  - _Requirements: 1.3, 1.4, 3.3, 12.2_

- [x] 2. Embedding module with pluggable provider
- [x] 2.1 Define embedding provider interface and types
  - Create `backend/src/embeddings/embedding.types.ts` with `EmbeddingProvider` interface (`embed(text): Promise<number[] | null>`, dimension constant 768)
  - _Requirements: 10.1_

- [x] 2.2 Implement Gemini and hash embedding providers
  - Create `backend/src/embeddings/gemini-embedding.provider.ts` calling Gemini `text-embedding-004` (768 dims) using `GEMINI_API_KEY`, never leaking the key
  - Create `backend/src/embeddings/hash-embedding.provider.ts` producing a deterministic 768-dim vector for use when no embedding key is configured
  - _Requirements: 10.1, 11.1_

- [x] 2.3 Implement EmbeddingService with fallback and cache
  - Create `backend/src/embeddings/embedding.service.ts` selecting the provider (Gemini when key present, hash otherwise), returning `null` on failure, and using a bounded LRU cache keyed by SHA-256 of normalized text
  - Create `backend/src/embeddings/embeddings.module.ts` exporting `EmbeddingService`
  - _Requirements: 10.1, 11.1, 12.2_

- [x] 2.4 Write property test for embedding cache and fallback
  - **Property: For any text, EmbeddingService returns a null result on provider failure and never throws; identical normalized inputs return cache-identical vectors**
  - **Validates: Requirements 11.1**

- [x] 3. Memory repository (Supabase access)
- [x] 3.1 Implement MemoryRepository
  - Create `backend/src/memory/memory.repository.ts` wrapping all Supabase access via `SupabaseService.admin`: `insert`, `findById`, `list` (type/status/text filter, ordering, pagination in one query), `matchMemories` (calls the SQL function), `update` (single `UPDATE ... WHERE id = ? AND user_id = ?`), `delete`, `deleteAll`
  - Map DB rows to the `Memory` domain type
  - _Requirements: 1.1, 2.1, 3.2, 12.2_

- [x] 4. Memory service (CRUD, isolation, dedup/conflict)
- [x] 4.1 Implement MemoryService CRUD with ownership enforcement
  - Create `backend/src/memory/memory.service.ts` with `createMemory`, `getMemory`, `searchMemories` (filter+text), `getRelevantMemories` (vector via `matchMemories`), `updateMemory`, `deleteMemory`, `deleteAllMemories`, and a private `assertOwned` mirroring `ConversationsService`
  - Assign default importance/confidence by type/source when not provided (constants from 1.3)
  - Return `MemoryView` (never embedding) from read/list operations
  - _Requirements: 1.1, 1.3, 1.4, 2.1, 2.2, 2.3, 3.3_

- [x] 4.2 Implement dedup and conflict resolution on create
  - In `createMemory`, use `matchMemories` (k=1) to find the nearest existing memory: cosine ≥ `DEDUP_SIMILARITY` reinforces the existing memory (bump importance/confidence + timestamp); conflicting same-type preference/personal_fact supersedes the old (status=superseded, `metadata.supersededBy`) in a single ownership-scoped update
  - _Requirements: 7.1, 7.2_

- [x] 4.3 Write property test for user isolation
  - **Property: For any two distinct users and any memory owned by user B, every operation (get/update/delete/search) invoked by user A is rejected and does not return or mutate B's memory**
  - **Validates: Requirements 2.1, 2.2, 2.3**

- [x] 4.4 Write property test for deduplication and conflict handling
  - **Property: For any memory and a near-identical new memory (cosine ≥ DEDUP_SIMILARITY), the store count is unchanged and the existing memory is reinforced; for any conflicting same-type memory, the old one is superseded and the new one becomes active**
  - **Validates: Requirements 7.1, 7.2**

- [x] 4.5 Write unit tests for default importance/confidence assignment
  - Verify explicit → high/0.95, auto preference/personal_fact/episodic → medium/0.6, behavioral gating by confidence threshold
  - _Requirements: 1.3, 1.4_

- [x] 5. Memory API (controller and DTOs)
- [x] 5.1 Implement memory DTOs
  - Create `backend/src/memory/dto/memory.dto.ts` with validated `CreateMemoryDto`, `UpdateMemoryDto`, and a `ListMemoryQueryDto` (optional `memory_type`, optional `search`); user id is never accepted from the body
  - _Requirements: 3.2, 3.3_

- [x] 5.2 Implement MemoryController
  - Create `backend/src/memory/memory.controller.ts` `@Controller('memory')` guarded by `SupabaseAuthGuard`, using `@CurrentUserId()` and `ParseUUIDPipe`, exposing `GET /memory`, `GET /memory/:id`, `POST /memory`, `PATCH /memory/:id`, `DELETE /memory/:id`, `DELETE /memory` (delete all); returns `MemoryView`
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 5.3 Wire the MemoryModule and register in AppModule
  - Create `backend/src/memory/memory.module.ts` importing `EmbeddingsModule`, `AuthModule`, and `AIModule`; provide repository/service; export `MemoryService`
  - Register `MemoryModule` (and `EmbeddingsModule`) in `backend/src/app.module.ts`
  - _Requirements: 3.1, 3.4_

- [x] 6. Checkpoint - Make sure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Memory extraction and command handling
- [x] 7.1 Implement MemoryExtractor command detection
  - Create `backend/src/memory/services/memory-extractor.service.ts` with a deterministic regex prefilter for remember/forget/"what do you remember" commands, then use `AIService` to normalize the fact (remember) or build a search query (forget)
  - _Requirements: 4.1, 4.2, 8.1_

- [x] 7.2 Implement automatic extraction with usefulness gating
  - Add `extractFromExchange(userId, conversationId, userText, aiText)` that evaluates usefulness/stability/relevance/non-triviality via `AIService`, skips trivial/ephemeral content, applies the behavioral confidence threshold, does not infer sensitive attributes, and does not invent unstated memories
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 7.3 Write property test for trivial content rejection
  - **Property: For any message classified as trivial/ephemeral, automatic extraction stores no memory; behavioral candidates below BEHAVIORAL_MIN_CONFIDENCE are not stored**
  - **Validates: Requirements 5.2, 5.3**

- [x] 7.4 Write unit tests for command detection
  - Verify remember/forget/"what do you remember" phrasings are detected and non-command messages are not
  - _Requirements: 4.1, 4.2, 8.1_

- [x] 8. Memory retrieval and context building
- [x] 8.1 Implement MemoryRetriever
  - Create `backend/src/memory/services/memory-retriever.service.ts` with `getRelevant(userId, query)` generating the query embedding and calling `matchMemories` (top-K + threshold), and `buildContext(userId, query)` returning a formatted block capped by `MAX_CONTEXT_MEMORIES` and `MAX_CONTEXT_CHARS`; returns empty context on any failure
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 11.1, 12.2_

- [x] 8.2 Write property test for scoped retrieval and bounded context
  - **Property: For any user and query, retrieved memories belong only to that user, all pass the similarity threshold, and the injected context never exceeds MAX_CONTEXT_MEMORIES/MAX_CONTEXT_CHARS**
  - **Validates: Requirements 2.3, 6.1, 6.2, 12.2**

- [x] 8.3 Write property test for last_accessed_at update on retrieval
  - **Property: For any retrieved memory, its last_accessed_at is advanced to at or after the retrieval time**
  - **Validates: Requirements 6.4**

- [x] 9. Memory manager and chat pipeline integration
- [x] 9.1 Implement MemoryManager orchestration
  - Create `backend/src/memory/services/memory-manager.service.ts` with `handleUserMessage(userId, conversationId, text)` returning `{ handled, reply? }` for remember/forget/"what do you remember" (forget reports nothing matched when no memory passes threshold; summary uses only stored memories), `buildMemoryContext`, and `extractFromExchange`; all methods catch errors internally and return safe defaults
  - _Requirements: 4.1, 4.2, 4.3, 8.1, 8.2, 11.1, 11.2_

- [x] 9.2 Integrate MemoryManager into MessagesService
  - In `backend/src/messages/messages.service.ts` `streamAssistantReply`/`sendAndStream`: first call `handleUserMessage` and, when handled, stream the confirmation and persist it without an LLM call; otherwise inject the memory context system message before history, run existing `AIService.stream`, then fire-and-forget `extractFromExchange` after a successful reply
  - Import `MemoryModule` into `MessagesModule`
  - _Requirements: 4.1, 4.2, 6.3, 11.1, 11.2, 13.1_

- [x] 9.3 Write property test for chat resilience when memory fails
  - **Property: For any user message, when embedding/search/store/extraction throws, the V1 chat pipeline still produces a reply (memory context empty) and does not error**
  - **Validates: Requirements 11.1, 11.2, 13.1**

- [x] 9.4 Write property test for forget with no match
  - **Property: For any forget command that matches no stored memory above threshold, the manager reports nothing matched and no memory is deleted or invalidated**
  - **Validates: Requirements 4.3**

- [x] 10. Checkpoint - Make sure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Frontend memory management UI
- [x] 11.1 Add memory types and API client methods
  - In `frontend/src/lib/types.ts` add `MemoryView`, `MemoryType`, `Importance`
  - In `frontend/src/lib/api-client.ts` add `listMemories` (type/search params), `getMemory`, `createMemory`, `updateMemory`, `deleteMemory`, `deleteAllMemories`
  - _Requirements: 3.1, 9.1_

- [x] 11.2 Build the /memory route
  - Create `frontend/src/app/memory/page.tsx` listing memories with a search box, type filter, edit modal, per-item delete, and delete-all; display memory type, created date, last accessed, and importance; never render embeddings or internal fields
  - _Requirements: 9.1, 9.2_

- [x] 11.3 Write test for memory page rendering and filtering
  - Verify list rendering shows type/created/last-accessed/importance and that type filter and search narrow results, with no embedding exposed
  - _Requirements: 9.1, 9.2_

- [ ] 12. Final Checkpoint - Make sure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
