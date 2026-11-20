# Sync between devices (optional)

Sync is **optional and off by default**. With `src/sync/config.js` empty the app
never makes a single sync request: everything lives in the browser
(IndexedDB/localStorage) exactly as before, and `#/extras/account` only says
*"Sync is not configured"*. Nothing below is needed to use the app.

When you do turn it on, the app copies four stores to the server — `srs`
(review cards), `progress`, `gamification` and `settings` — and merges them
between devices. The local-only `meta` store (session token, sync bookkeeping)
never leaves the device. **No encryption**: the server sees your study data in
plain text, protected only by your login and Row Level Security. Encrypting the
blobs is out of scope for now.

## Which free backend?

| | Supabase (free plan) | PocketBase self-hosted + Tailscale Funnel | Firebase (Spark) |
| --- | --- | --- | --- |
| Cost | $0 | $0 (software) + your homelab electricity | $0 |
| Always on | Pauses after **7 days of inactivity** (manual resume) | Yes, if the homelab is up 24/7 | Yes |
| Login without a server of our own | Email OTP / magic link, built in | Email/password + OTP, built in | Email/password + OAuth; email links need extra setup |
| Data access rules | Postgres **Row Level Security** (SQL policies) | Collection API rules (per-collection JS filters) | Firestore **security rules** (per-document expressions) |
| Client integration | Plain REST + Auth over `fetch` — no SDK needed | Plain REST over `fetch` — no SDK needed | SDK is effectively required (gRPC/WebChannel); REST exists but is awkward |
| Free quota | 2 active projects, 500 MB DB, 1 GB files, 5 GB egress, 50k monthly users | Your disk (SQLite file, a few MB here) | 1 GiB stored, 50k reads/day, 20k writes/day, 20k deletes/day, 10 GiB egress/month |
| Moving parts we own | None | Server, TLS, backups, uptime, exposure | None |
| Offline-first fit | Good: it is just a REST endpoint | Good | Workable but heaviest for our size |

### Recommendation: **Supabase**

- It is the only option where we **own no server** and still get real
  per-user access control (RLS) plus built-in email OTP — and it talks plain
  `fetch`, which is exactly what this zero-dependency PWA wants (no SDK to
  bundle, no build step change).
- PocketBase is excellent and cheaper on paper, but it only works while the
  homelab is reachable. Exposing it publicly means **Tailscale Funnel**, i.e.
  the study data of anyone using the app flows through the homelab, and we
  become responsible for TLS, updates, backups and uptime. That is a lot of
  new operational surface for a personal app.
- Firebase is the most "managed", but its client story is the Firebase SDK and
  its security model (security rules + document reads billed per read) fits an
  offline-first sync of whole stores less naturally than one SQL table.

### Free-plan limits and risks (Supabase)

- **Pausing is the real risk.** A free project is paused after **7 days of
  inactivity** and must be resumed by hand from the dashboard. If you sync
  weekly you are usually fine; if you leave it for a month, expect to click
  "Resume project" before syncing works again. (A free uptime pinger that hits
  the REST endpoint once a day is a common workaround, but that is your call.)
- 2 active projects, **500 MB** database (this app uses a few MB at most),
  5 GB egress/month, 1 GB file storage, 50k monthly active users.
- The built-in email sender is **rate-limited to a few messages per hour** and
  is meant for testing, not production. For a personal app that is plenty.
- No automated backups on the free plan — but the device copy is the source of
  truth and the server copy can be re-pushed at any time.

## Setup steps for David

Nothing here puts a secret in the repo. Only the **Project URL** and the
**`anon` public key** end up in `src/sync/config.js`; both are public by design
(they ship in the browser bundle) and the data is protected by RLS, not by
hiding them. **Never** copy the `service_role` key — it bypasses RLS.

1. Create a free account at <https://supabase.com> and click **New project**.
2. Pick an organization, a project name (e.g. `chino-sync`), a region close to
   you, and a database password. **Save that password in your password manager**
   — the app never needs it, so it must not go into the repo or into chat.
3. Wait for provisioning, then open **SQL Editor**, paste the whole of
   `deploy/supabase-schema.sql` and click **Run**. It creates the
   `sync_blobs` table and turns on Row Level Security.
4. Open **Authentication → Providers → Email** and make sure **Email** is
   enabled. Then open **Authentication → Email Templates → Magic Link** and add
   `{{ .Token }}` to the body if it is not already there — that is the 6-digit
   code the app asks for (the default template only ships a magic-link URL).
5. Open **Authentication → URL Configuration** and set **Site URL** to where the
   app is served, e.g. `https://<your-user>.github.io/chino-app/`.
6. Open **Project Settings → API**, copy **Project URL** and the **anon public**
   key, and paste them into `src/sync/config.js`:

   ```js
   export const SUPABASE_URL = 'https://<project-ref>.supabase.co';
   export const ANON_KEY = '<the anon public key>';
   ```

7. Rebuild/redeploy. Open `#/extras/account`, enter your email, tap **Send
   code**, then enter the 6-digit code from the email and tap **Sign in**.
   Use the same email on your other device and both will share the same data.

To turn sync off again, empty the two constants and redeploy; the app goes back
to being fully local (the server copy is untouched until you delete it from the
Account screen).

## How the sync behaves

- **Attach on boot, pull-merge-push on open.** `main.js` calls `sync.attach()`
  only when the config is filled (sync off = zero requests), so every local
  write to a synced store is queued. On open the client **pulls first, merges,
  then pushes the merged state** (`syncNow`). Pull-first narrows the window, and
  the **server-side trigger** on `sync_blobs` closes it: an upsert that conflicts
  with a newer row keeps the newer `updated_at`, so a device holding an old copy
  cannot overwrite a newer server row even if another device wrote between this
  client's pull and its push.
- **Offline is safe.** A failed request never throws: the change stays in the
  local queue and is sent on the next **Sync now**. A `401` is retried once
  with `POST /auth/v1/token?grant_type=refresh_token` before giving up.
- **Per-record deterministic merge** (`src/sync/merge.js`, pure and
  unit-tested): the winner is the **newest `updated_at`**. Review cards (`srs`)
  first compare the number of reviews, so a device with a skewed clock cannot
  wipe out real study work; equal reviews fall back to `updated_at`. On an
  exact timestamp tie the winner is chosen from the **value itself** (and a
  tombstone always beats a live value), so `merge(a,b)` and `merge(b,a)` agree:
  two devices editing in the same millisecond converge instead of keeping their
  own copy.
- **Deletions are tombstones.** `storage.remove()` fires the same write hook as
  `set()` with `deleted: true`; the client records a tombstone
  (`value = null, deleted = true`) and pushes it like any other write. A pull
  that sees a winning tombstone removes the local key, and a later sync cannot
  resurrect it. A genuinely newer edit still beats an older delete (that is a
  deliberate edit, not a resurrection loop).
- **Idempotent.** Pushing is an upsert on `(user_id, store, key)`; syncing twice
  changes nothing and creates no duplicate rows.
- **Nothing secret is uploaded.** Only the four synced stores (`srs`,
  `progress`, `gamification`, `settings`) are collected; the `meta` store —
  OpenRouter key and the sync session/bookkeeping — never leaves the device.
  The backup export already lists those keys as private; the convergence test
  asserts it.
- **Delete my data from the server** removes every row you own (RLS scopes the
  delete to you) and leaves the local copy alone.

## Protocol: final schema for your Supabase project

The client only needs one table. Run this in the SQL Editor (it is the same
file as `deploy/supabase-schema.sql`; keep them in sync):

```sql
create table if not exists public.sync_blobs (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  store      text        not null,               -- 'srs' | 'progress' | 'gamification' | 'settings'
  key        text        not null,               -- storage key inside that store
  value      jsonb,                              -- stored value (null for a tombstone)
  updated_at timestamptz not null default now(), -- merge clock (ms precision from the client)
  deleted    boolean     not null default false, -- tombstone: removed on some device
  primary key (user_id, store, key)
);

alter table public.sync_blobs enable row level security;

drop policy if exists "sync_blobs own rows" on public.sync_blobs;
create policy "sync_blobs own rows" on public.sync_blobs
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Keep the row with the NEWER updated_at on every UPDATE. An upsert that hits
-- the primary key becomes an UPDATE, so this trigger fires on it: a device that
-- pushes an older copy of a row (its pull raced another device's write) cannot
-- overwrite the newer row — the trigger returns the existing one instead.
create or replace function public.sync_blobs_keep_newer()
returns trigger
language plpgsql
as $$
begin
  if new.updated_at < old.updated_at then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_blobs_keep_newer on public.sync_blobs;
create trigger sync_blobs_keep_newer
  before update on public.sync_blobs
  for each row execute function public.sync_blobs_keep_newer();
```

Rows are upserted (`Prefer: resolution=merge-duplicates`) and `user_id` is
never sent: the column default fills it from the JWT, so RLS keeps every user
inside their own rows. The client merges locally before pushing, and the
`sync_blobs_keep_newer` trigger makes the server keep the newest row on a
conflict, so the client never has to reason about another device's writes.
