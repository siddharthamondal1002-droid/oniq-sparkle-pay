-- The shared weather cache.
--
-- OWNER DIRECTIVE 2026-09-04h: Google Weather, authenticated with the Firebase
-- service account — the same credential Vertex uses under directive
-- 2026-09-04e, so weather lands on that project's bill.
--
-- THIS TABLE IS THE COST CONTROL, which is why it is a table rather than a Map
-- in the edge function. Every lookup is metered, and the reading is wanted for
-- a chip on the HOME screen — the most-opened surface in the app. Without a
-- shared cache the bill scales with users and app opens; with one it scales
-- with PLACES and TIME, because everyone inside the same ~11 km cell shares a
-- row for fifteen minutes.
--
-- An edge isolate's memory would not do it. Supabase runs many isolates and
-- recycles them, so a module-scope cache cuts repeat calls within one
-- isolate's life and lets every cold start pay again.

create table if not exists public.weather_cache (
  -- "lat,lon" snapped to a 0.1 degree grid — see cacheKey() in
  -- _shared/weatherCore.ts, which is the ONLY place this string is built.
  cell        text primary key,
  -- The mapped reading, not Google's raw body: whatever is stored here is
  -- served verbatim to the client, so it holds exactly the fields ONIQ shows
  -- and nothing it does not need to keep.
  reading     jsonb       not null,
  -- The air-quality reading, added with owner directive 2026-09-04i. NULLABLE
  -- on purpose: airquality.googleapis.com is a second API and may be
  -- unavailable or unenabled while weather works, and losing a temperature
  -- because an air index was missing would trade a working feature for one
  -- that is not.
  air         jsonb,
  fetched_at  timestamptz not null default now()
);

comment on table public.weather_cache is
  'Shared, place-keyed weather readings. Not user data: a cell is a ~11 km grid square, never a person, and no user id is stored. Exists so a metered Google lookup is made once per place per quarter hour rather than once per app open.';
comment on column public.weather_cache.air is
  'Google Air Quality currentConditions, mapped. Null when the air lookup failed or the Air Quality API is not enabled on the project — the weather half still stands.';
comment on column public.weather_cache.cell is
  'Latitude,longitude snapped to a 0.1 degree grid (about 11 km). Built only by cacheKey() in supabase/functions/_shared/weatherCore.ts.';
comment on column public.weather_cache.fetched_at is
  'When Google was actually asked. Freshness is judged here rather than by a TTL column, so changing CACHE_TTL_SECONDS needs no migration.';

-- Sweeping stale rows, and the freshness check itself, both read this.
create index if not exists weather_cache_fetched_at_idx
  on public.weather_cache (fetched_at);

-- RLS ON WITH NO POLICIES: nothing but the service role may read or write it.
--
-- That is the whole intent. This table is written by the `weather` edge
-- function using the service-role client and read by nobody else; a client
-- that could read it directly could enumerate which parts of the world ONIQ
-- users are asking about, which is not something a signed-in stranger needs.
-- The edge function bypasses RLS by holding the service role, so no policy is
-- required for it to work.
alter table public.weather_cache enable row level security;
