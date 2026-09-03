-- ONIQ Watch library — the personal layer over the channel directory.
--
-- Owner mission, 2026-09-03: "Upgrade the existing ONIQ Watch experience into
-- a production-grade, intelligent cross-platform watch system." Saved items
-- from YouTube, Vimeo, Nebula, the Internet Archive (and the two players that
-- already play in Watch, Dailymotion and Twitch), with progress, collections,
-- threads, moments, notes and rights metadata.
--
-- WHAT IS STORED, and what is not. A row is a REFERENCE: provider, the
-- provider's own content id, the canonical page URL, title, creator, duration
-- and rights metadata where the provider publishes them, plus everything ONIQ
-- adds on top — state, reason, priority, progress, notes, topics, tags,
-- relationships. No media file, no stream URL, no transcript is ever stored.
-- Playback goes to the provider's own player or page (src/data/watchEmbeds.ts,
-- src/lib/watch/providers.ts).
--
-- PRIVACY. Every table carries user_id and row-level security scoped to
-- auth.uid(). The link tables (collection items, thread items, moments) also
-- require the referenced item — and collection or thread — to belong to the
-- caller, so a guessed uuid cannot attach a stranger's item to one's own
-- collection or read anything through the join.
--
-- The existing Watch tables (user_channels, user_watch_genres,
-- user_watch_channels) are untouched: they remain the channel directory's
-- "My TV" and user genres, and the library's Following surface reads them.

create table public.watch_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null
    check (provider in ('youtube', 'vimeo', 'nebula', 'internet_archive', 'dailymotion', 'twitch')),
  content_id text not null check (length(content_id) between 1 and 200),
  canonical_url text not null check (length(canonical_url) between 8 and 500),
  title text not null check (length(trim(title)) between 1 and 200),
  creator text check (creator is null or length(creator) <= 120),
  duration_seconds integer check (duration_seconds is null or duration_seconds between 1 and 360000),
  -- Kept where the provider's own metadata endpoint supplies one. Cards render
  -- a glyph, not artwork, per src/config/playCompliance.ts.
  thumbnail_url text check (thumbnail_url is null or length(thumbnail_url) <= 500),
  state text not null default 'inbox' check (state in ('inbox', 'library', 'archived')),
  -- "Why did I save this?" — optional, never forced.
  reason text check (reason is null or reason in
    ('watch_later', 'research', 'learn', 'inspiration', 'reference', 'share', 'oniq')),
  priority smallint not null default 0 check (priority between 0 and 3),
  position_seconds integer not null default 0 check (position_seconds >= 0),
  completed_at timestamptz,
  last_watched_at timestamptz,
  notes text check (notes is null or length(notes) <= 4000),
  tags text[] not null default '{}',
  topics text[] not null default '{}',
  -- Internet Archive rights: {"class": "public_domain"|"creative_commons"|"permitted"|"unknown",
  --   "licenseUrl": ..., "source": ..., "checkedAt": ...}. Null = never checked.
  rights jsonb,
  -- Provider metadata as returned by its public endpoint (oEmbed / archive.org
  -- metadata), trimmed to a few fields. Never a stream URL.
  metadata jsonb not null default '{}'::jsonb,
  -- Cross-provider identity: items that are the same underlying video share a
  -- group id. Assigned only at high confidence, and the user can clear it.
  duplicate_group_id uuid,
  resurface_dismissed_at timestamptz,
  resurface_dismissals integer not null default 0 check (resurface_dismissals >= 0),
  saved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint watch_items_user_provider_content_key unique (user_id, provider, content_id)
);
create index watch_items_user_state_saved_idx on public.watch_items (user_id, state, saved_at desc);
create index watch_items_user_watched_idx on public.watch_items (user_id, last_watched_at desc);
create index watch_items_user_dup_idx on public.watch_items (user_id, duplicate_group_id)
  where duplicate_group_id is not null;
create index watch_items_user_title_idx on public.watch_items (user_id, lower(title));
create index watch_items_topics_idx on public.watch_items using gin (topics);

grant select, insert, update, delete on public.watch_items to authenticated;
grant all on public.watch_items to service_role;
alter table public.watch_items enable row level security;
create policy "Users read own watch items" on public.watch_items
  for select to authenticated using (user_id = auth.uid());
create policy "Users add own watch items" on public.watch_items
  for insert to authenticated with check (user_id = auth.uid());
create policy "Users update own watch items" on public.watch_items
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users delete own watch items" on public.watch_items
  for delete to authenticated using (user_id = auth.uid());
create trigger watch_items_touch before update on public.watch_items
  for each row execute function public.tg_touch_updated_at();


create table public.watch_collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint watch_collections_user_name_key unique (user_id, name)
);
create index watch_collections_user_pos_idx on public.watch_collections (user_id, position);
grant select, insert, update, delete on public.watch_collections to authenticated;
grant all on public.watch_collections to service_role;
alter table public.watch_collections enable row level security;
create policy "Users read own watch collections" on public.watch_collections
  for select to authenticated using (user_id = auth.uid());
create policy "Users add own watch collections" on public.watch_collections
  for insert to authenticated with check (user_id = auth.uid());
create policy "Users update own watch collections" on public.watch_collections
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users delete own watch collections" on public.watch_collections
  for delete to authenticated using (user_id = auth.uid());
create trigger watch_collections_touch before update on public.watch_collections
  for each row execute function public.tg_touch_updated_at();


create table public.watch_collection_items (
  collection_id uuid not null references public.watch_collections(id) on delete cascade,
  item_id uuid not null references public.watch_items(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  position integer not null default 0,
  added_at timestamptz not null default now(),
  primary key (collection_id, item_id)
);
create index watch_collection_items_user_item_idx on public.watch_collection_items (user_id, item_id);
grant select, insert, update, delete on public.watch_collection_items to authenticated;
grant all on public.watch_collection_items to service_role;
alter table public.watch_collection_items enable row level security;
create policy "Users read own collection items" on public.watch_collection_items
  for select to authenticated using (user_id = auth.uid());
-- A link may only join the caller's OWN item to the caller's OWN collection.
create policy "Users add own collection items" on public.watch_collection_items
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (select 1 from public.watch_items i where i.id = item_id and i.user_id = auth.uid())
    and exists (select 1 from public.watch_collections c where c.id = collection_id and c.user_id = auth.uid())
  );
create policy "Users update own collection items" on public.watch_collection_items
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users delete own collection items" on public.watch_collection_items
  for delete to authenticated using (user_id = auth.uid());


create table public.watch_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  description text check (description is null or length(description) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint watch_threads_user_name_key unique (user_id, name)
);
create index watch_threads_user_idx on public.watch_threads (user_id, updated_at desc);
grant select, insert, update, delete on public.watch_threads to authenticated;
grant all on public.watch_threads to service_role;
alter table public.watch_threads enable row level security;
create policy "Users read own watch threads" on public.watch_threads
  for select to authenticated using (user_id = auth.uid());
create policy "Users add own watch threads" on public.watch_threads
  for insert to authenticated with check (user_id = auth.uid());
create policy "Users update own watch threads" on public.watch_threads
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users delete own watch threads" on public.watch_threads
  for delete to authenticated using (user_id = auth.uid());
create trigger watch_threads_touch before update on public.watch_threads
  for each row execute function public.tg_touch_updated_at();


create table public.watch_thread_items (
  thread_id uuid not null references public.watch_threads(id) on delete cascade,
  item_id uuid not null references public.watch_items(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  position integer not null default 0,
  note text check (note is null or length(note) <= 500),
  added_at timestamptz not null default now(),
  primary key (thread_id, item_id)
);
create index watch_thread_items_user_item_idx on public.watch_thread_items (user_id, item_id);
grant select, insert, update, delete on public.watch_thread_items to authenticated;
grant all on public.watch_thread_items to service_role;
alter table public.watch_thread_items enable row level security;
create policy "Users read own thread items" on public.watch_thread_items
  for select to authenticated using (user_id = auth.uid());
create policy "Users add own thread items" on public.watch_thread_items
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (select 1 from public.watch_items i where i.id = item_id and i.user_id = auth.uid())
    and exists (select 1 from public.watch_threads t where t.id = thread_id and t.user_id = auth.uid())
  );
create policy "Users update own thread items" on public.watch_thread_items
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users delete own thread items" on public.watch_thread_items
  for delete to authenticated using (user_id = auth.uid());


create table public.watch_moments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_id uuid not null references public.watch_items(id) on delete cascade,
  at_seconds integer not null check (at_seconds >= 0),
  note text check (note is null or length(note) <= 500),
  collection_id uuid references public.watch_collections(id) on delete set null,
  created_at timestamptz not null default now()
);
create index watch_moments_user_item_idx on public.watch_moments (user_id, item_id, at_seconds);
grant select, insert, update, delete on public.watch_moments to authenticated;
grant all on public.watch_moments to service_role;
alter table public.watch_moments enable row level security;
create policy "Users read own watch moments" on public.watch_moments
  for select to authenticated using (user_id = auth.uid());
create policy "Users add own watch moments" on public.watch_moments
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (select 1 from public.watch_items i where i.id = item_id and i.user_id = auth.uid())
  );
create policy "Users update own watch moments" on public.watch_moments
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users delete own watch moments" on public.watch_moments
  for delete to authenticated using (user_id = auth.uid());
