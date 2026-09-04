create table if not exists public.weather_cache (
  cell        text primary key,
  reading     jsonb       not null,
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

create index if not exists weather_cache_fetched_at_idx
  on public.weather_cache (fetched_at);

grant all on public.weather_cache to service_role;

alter table public.weather_cache enable row level security;