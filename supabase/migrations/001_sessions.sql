-- PerfectPunch training sessions.
--
-- Run this once in the Supabase SQL editor (Dashboard -> SQL Editor -> New
-- query -> paste -> Run). It is safe to re-run: every statement is guarded.
--
-- The app writes through src/config/sessionStore.js, which upserts on
-- (user_id, session_id) so re-saving a session updates it in place.

create table if not exists public.sessions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  session_id     text not null,
  recorded_at    timestamptz not null default now(),
  summary        jsonb not null default '{}'::jsonb,
  punch_accuracy jsonb not null default '{}'::jsonb,
  reaction_times jsonb not null default '{}'::jsonb,
  defense        jsonb not null default '{}'::jsonb,
  timeline       jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now(),

  -- One row per session per user; this is the upsert target.
  constraint sessions_user_session_unique unique (user_id, session_id)
);

-- The dashboard always reads "this user's sessions, newest first".
create index if not exists sessions_user_recorded_at_idx
  on public.sessions (user_id, recorded_at desc);

-- Row-level security: a user can only ever see and write their own sessions.
alter table public.sessions enable row level security;

drop policy if exists "Users read own sessions"   on public.sessions;
drop policy if exists "Users insert own sessions" on public.sessions;
drop policy if exists "Users update own sessions" on public.sessions;
drop policy if exists "Users delete own sessions" on public.sessions;

create policy "Users read own sessions"
  on public.sessions for select
  using (auth.uid() = user_id);

create policy "Users insert own sessions"
  on public.sessions for insert
  with check (auth.uid() = user_id);

create policy "Users update own sessions"
  on public.sessions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users delete own sessions"
  on public.sessions for delete
  using (auth.uid() = user_id);
