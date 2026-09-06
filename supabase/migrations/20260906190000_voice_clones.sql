-- VOICE CLONES — one row per voice a person has had modelled on Vertex.
--
-- OWNER DIRECTIVE 2026-09-05, asked and answered: "Use vertex api through
-- firebase". Minting a replicated voice is a POST to Vertex AI on the metered
-- Google key, not the Lovable gateway, so a row here is a RECEIPT before it is
-- a convenience.
--
-- THE ROW IS THE CAP LEDGER, WHICH IS WHY DELETE MARKS RATHER THAN REMOVES.
-- image_jobs, music_jobs and voice_jobs all carry the same rule and it was
-- re-learned on 2026-09-06: the daily counts do not filter on status, so a
-- hard DELETE would let any signed-in person reset their own cap — and the
-- house cap — by deleting in a loop, buying unmetered spend on the owner's key
-- for the price of a delete. `status = 'deleted'` with `voice_key` nulled
-- keeps the receipt and destroys the credential.
--
-- THE KEY IS A CREDENTIAL WITH A SEVEN-DAY LIFE. voiceReplication.ts sends
-- `store: false`, so Google keeps NO copy — the row is the only one there is,
-- and Google will not reissue it. `expires_at` therefore travels with the key
-- rather than being derived at read time, because the two can disagree: a key
-- can be revoked or re-minted early, and `created_at + 7 days` would then be
-- confidently wrong. keyExpired() refuses one within a minute of expiry.
--
-- RLS: a person READS their own rows and WRITES NONE of them. There is
-- deliberately no insert, update or delete policy for `authenticated`, so RLS
-- denies all three; every write goes through the edge function on the service
-- role. A client that could insert here could name any voice key it liked,
-- including one minted from somebody else's recording.
--
-- `status` is checked against two values on purpose, and widening it is a
-- one-line migration. story_actor_assets.source was created on 2026-08-27 as
-- `check (source = 'generated')` — a check so narrow it had to be widened the
-- first time the column was used for anything. Two values is the smallest set
-- that still catches a typo; expiry is NOT one of them, because expires_at
-- already answers that and a second source of truth would drift from it.

create table if not exists public.voice_clones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  label text not null,
  language text not null,
  -- Nullable ONLY because delete nulls it. A 'ready' row always has one.
  voice_key text,
  expires_at timestamptz not null,
  status text not null default 'ready' check (status in ('ready', 'deleted')),
  created_at timestamptz not null default now()
);

-- The cap counts a person's rows over a rolling 24h and the list reads the
-- newest first; both are this index.
create index if not exists voice_clones_user_created_idx
  on public.voice_clones (user_id, created_at desc);

-- The house cap counts every row over a rolling 24h, across all users.
create index if not exists voice_clones_created_idx on public.voice_clones (created_at desc);

alter table public.voice_clones enable row level security;

drop policy if exists voice_clones_select_own on public.voice_clones;
create policy voice_clones_select_own on public.voice_clones
  for select to authenticated
  using (auth.uid() = user_id);
