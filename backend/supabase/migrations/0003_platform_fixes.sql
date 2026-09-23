-- ============================================================================
-- VICTOR platform fixes
--
-- 1. memories.embedding_model: vectors from different embedding models live in
--    different spaces and must never be compared. Retrieval filters on it.
-- 2. HNSW replaces IVFFlat: IVFFlat built on a small/empty table has poor
--    recall; HNSW needs no training data and stays accurate as rows grow.
-- 3. match_memories no longer writes: last_accessed_at is advanced by a
--    separate, off-path touch_memories call so reads stay reads.
-- 4. conversations.summary / summary_upto: rolling summary of older turns so
--    prompts stay within the model's context window.
-- 5. conversations listing by recency.
-- 6. usage_events: persisted token usage per AI call.
-- ============================================================================

-- 1. Embedding model ---------------------------------------------------------
alter table public.memories add column if not exists embedding_model text;

-- Existing vectors have unknown provenance; mark them so they are excluded
-- from retrieval until re-embedded (content is kept).
update public.memories
   set embedding_model = 'unknown'
 where embedding is not null and embedding_model is null;

-- 2. HNSW index ---------------------------------------------------------------
drop index if exists public.idx_memories_embedding;
create index if not exists idx_memories_embedding_hnsw
  on public.memories using hnsw (embedding vector_cosine_ops);

-- 3. match_memories (read-only, model-scoped) ---------------------------------
drop function if exists public.match_memories(uuid, vector, int, real);

create or replace function public.match_memories(
  p_user_id uuid,
  p_query   vector(768),
  p_k       int,
  p_min_sim real,
  p_model   text
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
stable
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
      and m.embedding_model = p_model
    order by m.embedding <=> p_query
    limit greatest(p_k * 4, p_k)
  )
  select
    r.id,
    r.user_id,
    r.content,
    r.memory_type,
    r.source,
    r.source_conversation_id,
    r.importance,
    r.confidence,
    r.status,
    r.metadata,
    r.created_at,
    r.updated_at,
    r.last_accessed_at,
    r.similarity,
    (0.70 * r.similarity
      + 0.20 * r.importance_weight
      + 0.10 * r.recency)::real as score
  from ranked r
  where r.similarity >= p_min_sim
  order by score desc
  limit p_k;
$$;

-- Advances last_accessed_at for memories that were injected into a prompt.
create or replace function public.touch_memories(
  p_user_id uuid,
  p_ids     uuid[]
)
returns void
language sql
as $$
  update public.memories
     set last_accessed_at = now()
   where user_id = p_user_id
     and id = any (p_ids);
$$;

-- 4. Conversation summaries ---------------------------------------------------
alter table public.conversations add column if not exists summary text;
alter table public.conversations add column if not exists summary_upto timestamptz;

-- 5. Recency-ordered conversation listing -------------------------------------
create index if not exists idx_conversations_user_updated
  on public.conversations (user_id, updated_at desc);

-- 6. Usage events ---------------------------------------------------------------
create table if not exists public.usage_events (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles (id) on delete cascade,
  kind              text not null,
  provider          text not null,
  model             text not null,
  prompt_tokens     integer not null default 0,
  completion_tokens integer not null default 0,
  created_at        timestamptz not null default now()
);

create index if not exists idx_usage_events_user_created
  on public.usage_events (user_id, created_at desc);

alter table public.usage_events enable row level security;

drop policy if exists usage_events_select_own on public.usage_events;
create policy usage_events_select_own on public.usage_events
  for select using (auth.uid() = user_id);
