# VICTOR V2 — Memory System Design

## Overview

V2 introduces a modular NestJS `MemoryModule` and an `EmbeddingModule`, a new
`memories` table with pgvector, and a thin integration point in the chat
pipeline. The AI is not the memory database — Supabase is the source of truth;
the AI only interprets stored memories.

```
User → Next.js → NestJS → AI Orchestrator (MessagesService)
                              ├─ MemoryManager (remember/forget commands)
                              ├─ MemoryRetriever → EmbeddingService → pgvector
                              │        ↓ relevant memories
                              └─ AIService (existing provider fallback) → reply
                                     ↓ (async) MemoryExtractor → store
```

## Architecture decisions

- **Reuse V1 infra.** Memory persistence uses `SupabaseService.admin`, the same
  pattern as conversations/messages. Ownership is enforced in the service layer
  exactly like `ConversationsService.assertOwned`, plus RLS as defense in depth.
- **AI abstraction reuse.** Extraction/summarization/classification use the
  existing `AIService` (provider fallback preserved). No Gemini-only logic.
- **Embeddings behind an interface.** `EmbeddingService` delegates to an
  `EmbeddingProvider`. Default: Gemini `text-embedding-004` (768 dims) via the
  existing key. A deterministic `HashEmbeddingProvider` fallback is used when no
  embedding key is configured so the system still functions in dev/tests. The
  column stores `vector(768)`.
- **Resilience first.** Every memory step is wrapped so failures never break the
  V1 reply. Retrieval/extraction failures are logged (no content/secrets) and
  the normal chat proceeds.

## Data model

### `memories` table (migration `0002_memory.sql`)
| column | type | notes |
|---|---|---|
| id | uuid PK | `gen_random_uuid()` |
| user_id | uuid FK profiles(id) ON DELETE CASCADE | ownership |
| content | text not null | the remembered fact |
| memory_type | text check in (explicit, preference, personal_fact, episodic, behavioral) | |
| source | text check in (user_explicit, auto_extracted) | provenance |
| source_conversation_id | uuid FK conversations(id) ON DELETE SET NULL | optional |
| importance | text check in (low, medium, high) | ranking/retention |
| confidence | real check 0..1 | certainty |
| status | text check in (active, superseded) default active | soft-invalidate |
| embedding | vector(768) | nullable when embedding unavailable |
| metadata | jsonb default '{}' | history, supersededBy, etc. |
| created_at / updated_at / last_accessed_at | timestamptz | |

Indexes:
- `idx_memories_user_active_type (user_id, status, memory_type)` — a single
  composite index that serves ownership-scoped listing, the `active` filter, and
  type filtering in one B-tree, so list/filter queries are a single index range
  scan (no full scan, no separate indexes to maintain).
- `idx_memories_embedding` — IVFFlat cosine ANN index for semantic search.
- `idx_memories_content_trgm` — GIN trigram index on `content` for fast
  case-insensitive text search (`ILIKE`/similarity) without scanning.

A single `match_memories(...)` SQL function performs the entire retrieval in one
round trip: user-scoped ANN search, similarity threshold, and a combined
relevance ranking that folds in `importance` and recency (see Performance). RLS
policies restrict all access to `auth.uid() = user_id` (the backend uses the
service role which bypasses RLS but still filters by user_id in code; RLS
protects any direct/anon access).

## Backend module structure

```
backend/src/embeddings/
  embeddings.module.ts
  embedding.service.ts
  embedding.types.ts
  gemini-embedding.provider.ts
  hash-embedding.provider.ts   (deterministic fallback)

backend/src/memory/
  memory.module.ts
  memory.controller.ts
  memory.service.ts            (public ops: CRUD + search, user-scoped)
  memory.repository.ts         (all Supabase access)
  memory.types.ts
  dto/memory.dto.ts
  services/
    memory-extractor.service.ts  (detect commands + auto-extraction via AIService)
    memory-retriever.service.ts  (query embedding → vector search → filter → context)
    memory-manager.service.ts    (orchestration used by chat pipeline)
```

### Types (`memory.types.ts`)
`MemoryType`, `MemorySource`, `Importance`, `MemoryStatus`, `Memory` (domain),
`MemoryView` (API-safe, no embedding), `CreateMemoryInput`, `UpdateMemoryInput`,
`MemorySearchOptions`.

### Operations (Requirement 3, 7)
`MemoryService`: `createMemory`, `getMemory`, `searchMemories` (filter+text),
`getRelevantMemories` (vector), `updateMemory`, `deleteMemory`,
`deleteAllMemories`, `getOwned` guard. Create runs dedup/conflict resolution in
a **single** DB call: `match_memories` returns the nearest existing memory with
its similarity, so the service decides insert vs reinforce vs supersede without
a second query. Near-identical (cosine ≥ 0.92) → reinforce existing (bump
importance/confidence + timestamp); conflicting same-type preference/fact →
supersede (status=superseded, metadata.supersededBy). The reinforce/supersede
write is itself a single `UPDATE ... WHERE id = ? AND user_id = ?` (ownership +
mutation in one statement).

`MemoryManager`: `handleUserMessage(userId, conversationId, text)` returns
`{ handled, reply? }` — detects explicit remember/forget and "what do you
remember" commands. `buildMemoryContext(userId, query)` returns a formatted
string block. `extractFromExchange(userId, conversationId, userText, aiText)`
runs async auto-extraction after a reply.

### Command detection (Requirement 4, 8)
Deterministic regex prefilter (`remember`, `don't forget`, `save this`,
`forget`, `remove that memory`, `what do you remember`, `show my memories`) to
avoid unnecessary AI calls, then `AIService` extracts the normalized fact for
storage or a search query for forget. Forget uses vector search to find the
target; if none pass the threshold, it reports nothing matched (Req 4.3).

### Importance & confidence rationale (Requirements 1.3, 1.4)
- explicit → importance HIGH, confidence 0.95 (user stated it directly).
- preference/personal_fact (auto) → MEDIUM, confidence 0.6.
- episodic (auto) → MEDIUM, confidence 0.6.
- behavioral (auto) → only stored when the extractor confidence ≥ 0.8; LOW/MED.
Documented in code constants so scoring is not arbitrary.

## Chat pipeline integration (`MessagesService.streamAssistantReply`)
1. `MemoryManager.handleUserMessage` — if a memory command, stream the
   confirmation text as the assistant reply and persist it; skip the LLM.
2. Otherwise `buildMemoryContext(userId, latestUserText)` — inject a `system`
   message with relevant memories (best-effort; failure → empty).
3. Run existing `AIService.stream` (fallback preserved).
4. After a successful reply, fire-and-forget `extractFromExchange` (never blocks
   or breaks the reply).

Context order: existing system prompt behavior + memory system message +
conversation history + current message (Requirement 6.3).

## API (Requirement 3)
`MemoryController` `@Controller('memory')` guarded by `SupabaseAuthGuard`,
`@CurrentUserId()`, `ParseUUIDPipe`, DTO validation. Returns `MemoryView`
(no embedding). Mirrors conversations controller conventions.

## Frontend (Requirement 9)
- `frontend/src/lib/types.ts`: add `MemoryView`, `MemoryType`, `Importance`.
- `api-client.ts`: `listMemories`, `getMemory`, `createMemory`, `updateMemory`,
  `deleteMemory`, `deleteAllMemories`.
- `frontend/src/app/memory/page.tsx`: list, search box, type filter, edit modal,
  delete, delete-all. No embeddings shown.

## Error handling (Requirement 11)
`MemoryManager` and `MemoryRetriever` catch all errors internally and return
safe defaults (`handled:false`, empty context). `EmbeddingService` returns
`null` on failure; retrieval with a null embedding returns no memories. Chat
proceeds regardless.

## Performance and complexity (Requirement 12.2)

Reality check: the dominant cost is network I/O — the embedding API call and the
AI generation call (each ~100s of ms). Our own DB/CPU work is negligible by
comparison. So "optimized" means (a) avoid unnecessary API calls, (b) do all DB
work in single, index-backed queries, (c) never load unbounded data into app
memory.

### Do more per query (fewer round trips, less DB load)
- **Retrieval = 1 query.** `match_memories(user_id, query, k, min_sim)` does
  ANN search + threshold + ranking + `last_accessed_at` bump in one call. The
  bump is done with a `UPDATE ... FROM (subquery) WHERE id = any(...)` inside the
  same function (CTE), so retrieval never issues a second write query.
- **Create dedup = 1 query.** The nearest-neighbour lookup that drives
  dedup/conflict reuses `match_memories` (k=1). No separate "does it exist"
  probe.
- **List/filter/text-search = 1 query.** Type filter, status filter, text
  search, ordering, and pagination are one SQL statement over the composite +
  trigram indexes. No N+1: `source_conversation_id` is not joined per-row; if a
  title is ever needed it is a single `LEFT JOIN conversations` in the same
  query, not a per-memory fetch.
- **Ranking in SQL, not app memory.** The combined score
  `0.70*similarity + 0.20*importance_weight + 0.10*recency` (importance mapped
  low/med/high → 0/0.5/1; recency = exp decay on `last_accessed_at`) is computed
  and ordered in the query, so only the final top-K rows cross the wire.

### Algorithms and complexity
- **ANN search: IVFFlat cosine**, ~O(√N) probed lists vs O(N) exact scan; keeps
  query time flat as a user's memory count grows. Approximate — accepted
  tradeoff for personal-scale data; exact scan is the fallback only if an index
  is absent.
- **Text search: GIN trigram**, sublinear `ILIKE`/similarity vs O(N·L) scan.
- **Per message (worst case):** 1 embedding call + 1 ANN query returning K rows +
  O(K) app-side assembly. **Best case:** 0 embedding calls (command/trivial
  short-circuit). K default = 8.
- **App-side space: O(K)** per request — never O(N). The full table is never
  materialized in Node.

### Avoiding work
- **Regex prefilter** for commands and a min-length/triviality gate skip the
  embedding call entirely on a large share of turns.
- **Embedding LRU cache** keyed by SHA-256 of normalized query text (bounded
  size, O(1) get/put) collapses repeated/identical queries to zero API calls.
- **Extraction is fire-and-forget**, off the response path — zero added reply
  latency.
- **Parallelism:** query embedding and recent-history read run concurrently
  (`Promise.all`) since they are independent.

### Bounded space in the prompt
- Context block is capped by `MAX_CONTEXT_MEMORIES` (default 8) and a character
  cap, so injected tokens stay bounded regardless of total stored memories.

### Tunable constants (single source in `memory.constants.ts`)
`TOP_K=8`, `MIN_SIMILARITY=0.75`, `DEDUP_SIMILARITY=0.92`,
`BEHAVIORAL_MIN_CONFIDENCE=0.8`, `MAX_CONTEXT_MEMORIES=8`,
`MAX_CONTEXT_CHARS=1200`, `EMBED_CACHE_SIZE=256`, `MIN_MESSAGE_LEN_FOR_RETRIEVAL`.
Ranking weights `{similarity:0.70, importance:0.20, recency:0.10}`. IVFFlat
`lists=100` (revisit as row counts grow).

## Testing (Requirement per section 25)
Backend Jest specs: memory.service CRUD + isolation (A cannot read/update/delete
B), dedup/conflict, extractor command detection, retriever filtering, embedding
fallback, and resilience (chat proceeds when memory throws). Frontend test for
the memory page rendering/filtering.
