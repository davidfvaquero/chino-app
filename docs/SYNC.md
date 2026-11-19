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

- **Pull on open, push on change.** Opening the Account screen (or a sync) pulls
  the server state and merges it in; every local write to a synced store is
  queued and pushed by the next sync.
- **Offline is safe.** A failed request never throws: the change stays in the
  local queue and is sent on the next **Sync now**.
- **Merge rule** (`src/sync/merge.js`, pure and unit-tested): per key,
  last-writer-wins on `updated_at`. Exception: review cards (`srs`) keep the
  copy with the **higher number of reviews**, so a device with a skewed clock
  cannot wipe out real study work. A deletion is a tombstone row
  (`deleted = true`) and behaves like any other write — newest side wins, ties
  go to the tombstone.
- **Delete my data from the server** removes every row you own (RLS scopes the
  delete to you) and leaves the local copy alone.
