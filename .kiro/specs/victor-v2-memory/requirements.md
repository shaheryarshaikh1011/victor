# VICTOR V2 — Memory System Requirements

## Introduction

V2 adds persistent, user-scoped memory to VICTOR. It builds on the V1
architecture (Next.js Web_Client → NestJS Backend_API → Supabase Postgres +
pgvector; AI provider abstraction with fallback) without replacing it. Memory
enhances chat but must never make basic chat unavailable.

The system is modular so future versions (Finance, Tasks, Agents, Personal
Knowledge) can reuse the same retrieval architecture.

## Glossary

- **Memory** — a persisted, user-scoped unit of remembered information.
- **Memory_Type** — one of `explicit`, `preference`, `personal_fact`,
  `episodic`, `behavioral`.
- **Importance** — a coarse retention/ranking signal (`low`/`medium`/`high`).
- **Confidence** — how certain the fact is (0..1); explicit statements are high.
- **Embedding** — a vector representation used for semantic retrieval.
- **Authenticated_User_Id** — the Supabase auth uid derived from the verified
  session (never taken from the request body).

## Requirements

### Requirement 1 — Memory persistence and model
**User Story:** As a user, I want VICTOR to store important information about me
so it can use it later.

#### Acceptance Criteria
1. WHEN a memory is created THEN the system SHALL persist it with `id`,
   `user_id`, `content`, `memory_type`, `source`, `source_conversation_id`,
   `importance`, `confidence`, `embedding`, `metadata`, `created_at`,
   `updated_at`, and `last_accessed_at`.
2. The system SHALL support memory types `explicit`, `preference`,
   `personal_fact`, `episodic`, and `behavioral`.
3. WHEN a memory is created without an explicit importance THEN the system SHALL
   assign one based on the memory type and source.
4. The system SHALL store confidence separately from importance; explicit user
   instructions SHALL have high confidence and automatic inferences lower.

### Requirement 2 — User isolation (critical)
**User Story:** As a user, my memories must be private to me.

#### Acceptance Criteria
1. Every memory operation (read, search, create, update, delete) SHALL be
   scoped to the Authenticated_User_Id derived from the verified session.
2. WHEN User A requests a memory owned by User B THEN the system SHALL reject the
   request (forbidden/not-found) and SHALL NOT return or mutate the memory.
3. Semantic search SHALL only match the caller's own memories.
4. The backend SHALL enforce ownership independently of the frontend, and the
   database SHALL apply Row Level Security as defense in depth.

### Requirement 3 — Memory operations API
**User Story:** As a client, I want a typed API to manage memories.

#### Acceptance Criteria
1. The Backend_API SHALL expose `GET /memory`, `GET /memory/:id`,
   `POST /memory`, `PATCH /memory/:id`, `DELETE /memory/:id`, and
   `DELETE /memory` (delete all).
2. `GET /memory` SHALL support optional filtering by `memory_type` and a text
   `search` query.
3. All endpoints SHALL use DTO validation and SHALL NOT expose embeddings or
   internal database columns.
4. All endpoints SHALL require authentication.

### Requirement 4 — Explicit memory (remember/forget)
**User Story:** As a user, I want to tell VICTOR to remember or forget things.

#### Acceptance Criteria
1. WHEN a user message is a remember command (e.g. "Remember that…",
   "Don't forget…", "Save this…") THEN the system SHALL extract and store the
   information as an `explicit` memory with high confidence and confirm it.
2. WHEN a user message is a forget command (e.g. "Forget that…",
   "Remove that memory…") THEN the system SHALL find the relevant memory,
   delete or invalidate it, and confirm the change.
3. WHEN a forget command matches no memory THEN the system SHALL say nothing
   matched rather than claiming success falsely.

### Requirement 5 — Automatic extraction
**User Story:** As a user, I want VICTOR to remember useful facts from normal
conversation without saving trivia.

#### Acceptance Criteria
1. The system SHALL evaluate candidate memories for usefulness, stability,
   relevance, and non-triviality before storing.
2. The system SHALL NOT store trivial/ephemeral content (e.g. "I'm hungry",
   "What's the weather?", "Tell me a joke").
3. Behavioral memories SHALL require a higher threshold before automatic
   storage.
4. The system SHALL NOT automatically infer sensitive personal attributes.
5. The system SHALL NOT invent memories that were not stated.

### Requirement 6 — Semantic retrieval and context
**User Story:** As a user, I want VICTOR to use relevant memories in replies.

#### Acceptance Criteria
1. WHEN a user sends a message THEN the system SHALL generate a query embedding,
   run a user-scoped vector search, and select only relevant memories via
   top-K + relevance/importance filtering.
2. The system SHALL NOT inject every stored memory into every prompt.
3. The system SHALL add selected memories to the AI context as a clearly
   formatted block, ordered after system instructions and before recent
   conversation.
4. WHEN memories are retrieved THEN the system SHALL update their
   `last_accessed_at`.

### Requirement 7 — Deduplication and conflict handling
**User Story:** As a user, I don't want duplicate or stale memories.

#### Acceptance Criteria
1. WHEN a new memory is semantically near-identical to an existing one THEN the
   system SHALL update/reinforce the existing memory instead of duplicating.
2. WHEN a new memory conflicts with an existing one (e.g. "prefers dark mode"
   then "prefers light mode") THEN the system SHALL supersede the old memory and
   record the change in metadata.

### Requirement 8 — "What do you remember about me?"
**User Story:** As a user, I want to ask what VICTOR knows about me.

#### Acceptance Criteria
1. WHEN the user asks what VICTOR remembers THEN the system SHALL retrieve the
   caller's stored memories and summarize them.
2. The system SHALL NOT claim to remember information not present in storage.

### Requirement 9 — Memory management UI
**User Story:** As a user, I want a UI to manage my memories.

#### Acceptance Criteria
1. The Web_Client SHALL provide a `/memory` route to view, search, filter by
   type, edit, delete individual memories, and delete all.
2. The UI SHALL display memory type, created date, last accessed, and
   importance, and SHALL NOT expose embeddings or internal implementation.

### Requirement 10 — Provider-independent embeddings
**User Story:** As a maintainer, I want embeddings to be swappable.

#### Acceptance Criteria
1. Embeddings SHALL be produced via an `EmbeddingService` backed by a pluggable
   `EmbeddingProvider`, not hardcoded to one vendor.
2. Memory features SHALL reuse the existing AI provider abstraction for any LLM
   calls (extraction/summarization) rather than a hardcoded provider.

### Requirement 11 — Resilience
**User Story:** As a user, chat must keep working even if memory fails.

#### Acceptance Criteria
1. WHEN embedding generation, vector search, or the memory store fails THEN the
   system SHALL log the failure without secrets and continue the normal V1 chat
   pipeline without memory context.
2. WHEN an AI call for extraction/summarization fails THEN memory features
   SHALL degrade gracefully and SHALL NOT break the reply.

### Requirement 12 — Privacy and performance
#### Acceptance Criteria
1. The system SHALL NOT log memory content or secrets in normal operation.
2. The system SHALL avoid unnecessary embedding generation and expensive
   searches, use DB indexes, and bound retrieval with a reasonable top-K.

### Requirement 13 — V1 regression
#### Acceptance Criteria
1. All V1 functionality (auth, chat, conversations, message history, streaming,
   provider fallback, settings, deletion) SHALL continue to work unchanged.

## V2 Definition of Done
The following end-to-end scenario must work:
1. User: "Remember that I prefer concise answers." → stored + confirmed.
2. In a new conversation, user asks "How should you respond to me?" → VICTOR
   retrieves the memory and responds accordingly.
3. User: "Forget my preference for concise answers." → removed/invalidated.
4. User asks about the preference again → VICTOR does NOT claim it still exists.
