-- deploy/supabase-schema.sql — optional cross-device sync (Supabase).
--
-- Run this ONCE in your Supabase project: Dashboard -> SQL Editor -> paste ->
-- Run. It creates the only table the app uses and locks it down with Row Level
-- Security, so every user can read and write ONLY their own rows.
--
-- The `anon` key in src/sync/config.js is public and safe to commit: RLS is
-- what protects the data, not secrecy of the key. Never put the service_role
-- key in the repo.
--
-- The client (src/sync/client.js) upserts rows with
--   Prefer: resolution=merge-duplicates
-- on the primary key (user_id, store, key), and never sends user_id — the
-- default below fills it from the caller's JWT, so a client cannot spoof
-- another user's rows.

create table if not exists public.sync_blobs (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  store      text        not null,             -- 'srs' | 'progress' | 'gamification' | 'settings'
  key        text        not null,             -- the storage key inside that store
  value      jsonb,                            -- the stored value (null for a tombstone)
  updated_at timestamptz not null default now(),
  deleted    boolean     not null default false, -- tombstone: the key was deleted on some device
  primary key (user_id, store, key)
);

alter table public.sync_blobs enable row level security;

-- One policy for the whole CRUD surface: a row is visible/editable only when
-- it belongs to the current user.
drop policy if exists "sync_blobs own rows" on public.sync_blobs;
create policy "sync_blobs own rows" on public.sync_blobs
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
