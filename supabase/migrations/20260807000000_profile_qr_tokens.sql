-- Track A3 — revocable profile QR tokens.
--
-- ADDITIVE AND REVERSIBLE. One new table, four new functions, no change to any
-- existing table, column, policy or function. The down migration is at the
-- bottom, commented, and drops exactly what this creates.
--
-- WHY A SEPARATE TABLE AND NOT A COLUMN ON profiles
--
-- profiles has `profiles_select_all` with USING (true) for authenticated. A
-- qr_token column there would be readable by every signed-in user, so anyone
-- could harvest the entire token table in one query and revocation would mean
-- nothing. The token lives in its own table with RLS on and NO policies: the
-- only way in is through the SECURITY DEFINER functions below, which means a
-- client-side mistake cannot leak it.
--
-- WHAT ROTATION ACTUALLY BUYS, STATED HONESTLY
--
-- /u/<user_id> already exists as a public profile page, so rotating a QR token
-- does NOT make a user unreachable — anyone holding their user id can still
-- open their profile. What rotation does is kill a specific printed, forwarded
-- or screenshotted CODE. That is a real property and worth having, and it is
-- the only one claimed here or in the UI copy.

-- ---------------------------------------------------------------- table ----

create table if not exists public.profile_qr_tokens (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  token          text not null unique,
  created_at     timestamptz not null default now(),
  rotated_at     timestamptz,
  rotation_count integer not null default 0,
  -- The same charset and length the client parser enforces. Kept in both
  -- places on purpose: the client check is a courtesy, this one is the
  -- control, and a token that cannot round-trip through the URL should never
  -- reach the table in the first place.
  constraint profile_qr_token_charset check (token ~ '^[A-Za-z0-9_-]{16,64}$')
);

comment on table public.profile_qr_tokens is
  'Revocable QR tokens for profile links. RLS on with no policies — reachable only via the SECURITY DEFINER functions in this migration.';

alter table public.profile_qr_tokens enable row level security;

-- No policies, deliberately. With RLS enabled and nothing granted, direct
-- access from anon or authenticated returns nothing at all. Belt and braces:
-- take the table grants away too, so this does not depend on RLS alone.
--
-- Tables carry no default PUBLIC grant, so naming the two roles is enough
-- here. FUNCTIONS ARE THE OPPOSITE — see the note on the generator below.
revoke all on table public.profile_qr_tokens from anon, authenticated;

-- ------------------------------------------------------------ generator ----

-- pgcrypto lives in the `extensions` schema here, and every function below
-- pins search_path to 'public', so gen_random_bytes must be schema-qualified.
--
-- 16 bytes = 128 bits, url-safe base64 = 22 characters. Unguessable, and short
-- enough to keep the QR readable at small sizes in poor light, which is the
-- actual scanning condition.
create or replace function public.gen_profile_qr_token()
returns text
language sql
volatile
set search_path to 'public'
as $$
  select translate(encode(extensions.gen_random_bytes(16), 'base64'), '+/=', '-_');
$$;

-- REVOKE FROM PUBLIC, NOT FROM THE TWO ROLES.
--
-- Postgres grants EXECUTE on every new function to PUBLIC by default, and
-- anon/authenticated inherit it. Revoking from those two roles by name removes
-- grants they never had and leaves the PUBLIC one in place, so the function
-- stays callable — which is exactly what happened on the first run of this
-- migration, and the reason every grant below is spelled out explicitly
-- instead of relying on a default.
revoke all on function public.gen_profile_qr_token() from public, anon, authenticated;

-- --------------------------------------------------------------- read -----

-- Get the caller's token, creating one on first use.
create or replace function public.my_profile_qr_token()
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  t  text;
begin
  if me is null then
    raise exception 'not authenticated';
  end if;

  select token into t from profile_qr_tokens where user_id = me;
  if t is not null then
    return t;
  end if;

  -- Two tabs opening My QR at once would both miss the select above. The
  -- conflict clause makes the loser a no-op and the re-select hands back the
  -- winner's token, so a user can never end up with two live codes.
  insert into profile_qr_tokens (user_id, token)
  values (me, gen_profile_qr_token())
  on conflict (user_id) do nothing;

  select token into t from profile_qr_tokens where user_id = me;
  return t;
end;
$$;

-- ------------------------------------------------------------- rotate -----

-- Burn the current code and issue a new one. Idempotent in the sense that
-- calling it twice simply yields two rotations; there is no state to corrupt.
create or replace function public.rotate_profile_qr_token()
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  t  text := gen_profile_qr_token();
begin
  if me is null then
    raise exception 'not authenticated';
  end if;

  insert into profile_qr_tokens (user_id, token, rotated_at, rotation_count)
  values (me, t, now(), 1)
  on conflict (user_id) do update
    set token          = excluded.token,
        rotated_at     = now(),
        rotation_count = profile_qr_tokens.rotation_count + 1;

  return t;
end;
$$;

-- ------------------------------------------------------------- resolve ----

-- Token -> the same four public fields public_profile_card already exposes,
-- plus the user id so the caller can send a moot request or open the profile.
--
-- Granted to anon as well as authenticated, because the point of an https QR
-- is that a stranger's system camera can open it and be offered the app. This
-- exposes nothing that /u/<user_id> does not already expose publicly.
create or replace function public.profile_card_by_qr_token(_token text)
returns table (user_id uuid, username text, display_name text, avatar_url text, bio text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select p.id, p.username, p.display_name, p.avatar_url, p.bio
  from profile_qr_tokens q
  join profiles p on p.id = q.user_id
  where q.token = _token;
$$;

-- --------------------------------------------------------------- grants ---
--
-- Every entry point stated in one place, PUBLIC stripped first so nothing
-- depends on a default. anon gets the resolver and nothing else: it is what a
-- stranger's camera needs, and the other two would only ever raise
-- 'not authenticated' for it anyway.
revoke all on function public.my_profile_qr_token()            from public, anon;
revoke all on function public.rotate_profile_qr_token()        from public, anon;
revoke all on function public.profile_card_by_qr_token(text)   from public;

grant execute on function public.my_profile_qr_token()          to authenticated;
grant execute on function public.rotate_profile_qr_token()      to authenticated;
grant execute on function public.profile_card_by_qr_token(text) to anon, authenticated;

-- ---------------------------------------------------------------- down ----
--
-- drop function if exists public.profile_card_by_qr_token(text);
-- drop function if exists public.rotate_profile_qr_token();
-- drop function if exists public.my_profile_qr_token();
-- drop function if exists public.gen_profile_qr_token();
-- drop table if exists public.profile_qr_tokens;
