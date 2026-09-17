-- Fixtures for running docs/payment-recovery/migration.sql against a THROWAWAY
-- local PostgreSQL cluster. Never run against any hosted project: it creates
-- stand-ins for objects production already owns.
--
-- Only what the reviewed SQL touches is stubbed: the five purchase tables (the
-- real column names, read from production's information_schema), `ops_alerts`
-- with its one-open-per-signal partial unique index, `is_admin`, `auth.uid()`
-- and the three roles the GRANT/REVOKE lines name.

create extension if not exists pgcrypto;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'service_role')   then create role service_role;   end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated')  then create role authenticated;  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon')           then create role anon;           end if;
end $$;

create schema if not exists auth;

-- The subject under test is set per-session with `set local test.uid`, so a
-- session that never sets it is the unauthenticated case — which is the case
-- the admin RPCs must fail closed on.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid
$$;

create table if not exists public.profiles (
  id uuid primary key,
  is_admin boolean not null default false
);

create or replace function public.is_admin(_uid uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select is_admin from public.profiles where id = _uid), false)
$$;

create table if not exists public.ops_alerts (
  id            bigserial primary key,
  signal        text,
  severity      smallint,
  summary       text,
  detail        jsonb default '{}'::jsonb,
  first_seen_at timestamptz default now(),
  last_seen_at  timestamptz default now(),
  notified_at   timestamptz,
  resolved_at   timestamptz,
  resolved_notified_at timestamptz
);
create unique index if not exists ops_alerts_one_open_per_signal
  on public.ops_alerts (signal) where resolved_at is null;

-- Chosen by SHAPE in production; here it simply has to exist for the tick.
create or replace function public.ops_watch_pick_key() returns text
language sql stable as $$ select null::text $$;

-- The five purchase tables, with the columns the enqueue/backfill statements
-- read. Column names are production's, not invented.
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(), user_id uuid, order_id uuid,
  provider text, provider_order_id text, provider_payment_id text,
  amount_minor bigint, currency text, status text, created_at timestamptz default now());
create table if not exists public.story_purchases (
  id uuid primary key default gen_random_uuid(), user_id uuid, price_paise integer,
  currency text, status text, provider text, provider_order_id text,
  provider_payment_id text, created_at timestamptz default now());
create table if not exists public.watermark_purchases (
  id uuid primary key default gen_random_uuid(), user_id uuid, price_paise integer,
  currency text, status text, provider text, provider_order_id text,
  provider_payment_id text, created_at timestamptz default now());
create table if not exists public.plan_purchases (
  id uuid primary key default gen_random_uuid(), user_id uuid, price_paise integer,
  currency text, status text, provider text, provider_order_id text,
  provider_payment_id text, created_at timestamptz default now());
create table if not exists public.video_purchases (
  id uuid primary key default gen_random_uuid(), user_id uuid, price_paise integer,
  currency text, status text, provider text, provider_order_id text,
  provider_payment_id text, created_at timestamptz default now());

create or replace function public.t_assert(cond boolean, msg text)
returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'ASSERT FAILED: %', msg; end if;
end $$;
