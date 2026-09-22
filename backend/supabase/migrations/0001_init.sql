-- ============================================================================
-- VICTOR V1 initial schema
--
-- Tables: profiles, user_settings, conversations, messages.
-- Ownership is scoped to profiles.id (the Supabase auth uid). Deleting a
-- conversation cascades to its messages. pgvector is enabled for future use
-- but is unused in V1.
-- ============================================================================

-- Extensions -----------------------------------------------------------------
create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "vector";      -- pgvector (unused in V1)

-- profiles -------------------------------------------------------------------
-- 1:1 with auth.users. id equals the Authenticated_User_Id.
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null unique,
  display_name text,
  created_at   timestamptz not null default now()
);

-- user_settings --------------------------------------------------------------
-- One row per user holding provider/model preferences.
create table if not exists public.user_settings (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  provider   text not null,
  model      text not null,
  updated_at timestamptz not null default now()
);

-- conversations --------------------------------------------------------------
create table if not exists public.conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  title      text not null default 'New Conversation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- messages -------------------------------------------------------------------
-- Deleting a conversation cascades to its messages (Requirement 3.4).
create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null,
  created_at      timestamptz not null default now()
);

-- Indexes --------------------------------------------------------------------
-- Ownership-scoped conversation listing (Requirement 3.2).
create index if not exists idx_conversations_user_id
  on public.conversations (user_id);

-- Ownership-scoped, ordered message reads (Requirement 4.3).
create index if not exists idx_messages_conversation_created
  on public.messages (conversation_id, created_at);
