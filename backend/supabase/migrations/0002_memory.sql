-- ============================================================================
-- VICTOR V2 memory schema
--
-- Adds a user-scoped `memories` table with pgvector embeddings plus the
-- retrieval helper `match_memories`. Ownership is scoped to profiles.id (the
-- Authenticated_User_Id). Row Level Security restricts all access to
-- auth.uid() = user_id as defense in depth; the backend uses the service role
-- and additionally filters by user_id in code (Requirements 1.1, 1.2, 2.4).
-- ============================================================================

-- Extensions -----------------------------------------------------------------
create extension if not exists "vector";   -- pgvector (embeddings)
create extension if not exists "pg_trgm";  -- trigram text search on content

-- memories -------------------------------------------------------------------
-- Deleting a profile cascades to its memories. The optional source
-- conversation is nulled when that conversation is deleted so a memory
-- survives conversation cleanup.
create table if not exists public.memories (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references public.profiles (id) on delete cascade,
  content                text not null,
  memory_type            text not null check (memory_type in (
                           'explicit', 'preference', 'personal_fact',
                           'episodic', 'behavioral')),
  source                 text not null check (source in (
                           'user_explicit', 'auto_extracted')),
  source_conversation_id uuid references public.conversations (id) on delete set null,
  importance             text not null check (importance in ('low', 'medium', 'high')),
  confidence             real not null check (confidence >= 0 and confidence <= 1),
  status                 text not null default 'active'
                           check (status in ('active', 'superseded')),
  embedding              vector(768),
  metadata               jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  last_accessed_at       timestamptz not null default now()
);

-- Indexes --------------------------------------------------------------------
-- Composite index serving ownership-scoped listing, the active-status filter,
-- and type filtering in a single B-tree (Requirement 12.2).
create index if not exists idx_memories_user_active_type
  on public.memories (user_id, status, memory_type);

-- IVFFlat cosine ANN index for semantic search (Requirement 12.2).
create index if not exists idx_memories_embedding
  on public.memories using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- GIN trigram index for fast case-insensitive text search on content.
create index if not exists idx_memories_content_trgm
  on public.memories using gin (content gin_trgm_ops);

-- Row Level Security ---------------------------------------------------------
-- Restrict all direct access to the owning user (Requirement 2.4).
alter table public.memories enable row level security;

drop policy if exists memories_select_own on public.memories;
create policy memories_select_own on public.memories
  for select using (auth.uid() = user_id);

drop policy if exists memories_insert_own on public.memories;
create policy memories_insert_own on public.memories
  for insert with check (auth.uid() = user_id);

drop policy if exists memories_update_own on public.memories;
create policy memories_update_own on public.memories
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists memories_delete_own on public.memories;
create policy memories_delete_own on public.memories
  for delete using (auth.uid() = user_id);

-- match_memories -------------------------------------------------------------
-- User-scoped approximate-nearest-neighbour retrieval in a single round trip
-- (Requirements 2.3, 6.1, 6.4, 12.2).
--
-- Steps, all within one call:
--   1. ANN search over the caller's active memories with a non-null embedding.
--   2. Similarity threshold (cosine similarity = 1 - cosine distance).
--   3. Combined ranking: 0.70*similarity + 0.20*importance_weight + 0.10*recency
--      where importance maps low/medium/high -> 0/0.5/1 and recency is an
--      exponential decay on last_accessed_at (half-life ~30 days).
--   4. Bump last_accessed_at for the returned rows via a CTE so retrieval never
--      issues a second write query (Requirement 6.4).
create or replace function public.match_memories(
  p_user_id uuid,
  p_query   vector(768),
  p_k       int,
  p_min_sim real
)
returns table (
  id                     uuid,
  user_id                uuid,
  content                text,
  memory_type            text,
  source                 text,
  source_conversation_id uuid,
  importance             text,
  confidence             real,
  status                 text,
  metadata               jsonb,
  created_at             timestamptz,
  updated_at             timestamptz,
  last_accessed_at       timestamptz,
  similarity             real,
  score                  real
)
language sql
as $$
  with ranked as (
    select
      m.id,
      m.user_id,
      m.content,
      m.memory_type,
      m.source,
      m.source_conversation_id,
      m.importance,
      m.confidence,
      m.status,
      m.metadata,
      m.created_at,
      m.updated_at,
      m.last_accessed_at,
      (1 - (m.embedding <=> p_query))::real as similarity,
      case m.importance
        when 'high' then 1.0
        when 'medium' then 0.5
        else 0.0
      end as importance_weight,
      exp(
        -ln(2) *
        (extract(epoch from (now() - m.last_accessed_at)) / (30 * 24 * 3600))
      ) as recency
    from public.memories m
    where m.user_id = p_user_id
      and m.status = 'active'
      and m.embedding is not null
    order by m.embedding <=> p_query
    limit greatest(p_k * 4, p_k)
  ),
  filtered as (
    select
      r.*,
      (0.70 * r.similarity
        + 0.20 * r.importance_weight
        + 0.10 * r.recency)::real as score
    from ranked r
    where r.similarity >= p_min_sim
    order by score desc
    limit p_k
  ),
  bumped as (
    update public.memories mm
    set last_accessed_at = now()
    where mm.id in (select f.id from filtered f)
    returning mm.id
  )
  select
    f.id,
    f.user_id,
    f.content,
    f.memory_type,
    f.source,
    f.source_conversation_id,
    f.importance,
    f.confidence,
    f.status,
    f.metadata,
    f.created_at,
    f.updated_at,
    now() as last_accessed_at,
    f.similarity,
    f.score
  from filtered f
  where exists (select 1 from bumped b where b.id = f.id)
  order by f.score desc;
$$;
