-- Track A2 — cached, on-demand chat message translations.
--
-- ADDITIVE AND REVERSIBLE. One new table, one new helper, one new trigger
-- function and one trigger on messages. No existing table, column, policy or
-- function is altered. The down migration is at the bottom, commented.
--
-- ON DEMAND, NEVER AUTOMATIC — AND THAT IS A PRIVACY DECISION, NOT A COST ONE
--
-- Translating a message sends SOMEONE ELSE'S WORDS to a third-party model
-- provider. Auto-translating every incoming message would ship whole
-- conversations to that provider because one participant changed a setting,
-- and the people who wrote those messages never asked for it. So translation
-- happens only when a reader explicitly taps Translate on one message, and
-- only that message leaves.
--
-- (Chat is already server-readable by design so that this can work at all —
-- that is recorded in src/config/mediaStorage.ts. This is a further hop, to a
-- different company, and it deserves its own decision.)
--
-- WHY THE CACHE IS KEYED BY MESSAGE AND NOT BY TEXT
--
-- A shared (message_id, target_lang) cache means a group chat with five Hindi
-- readers pays for one translation, not five. Keying by text hash instead
-- would be tempting and is worse: it would silently join unrelated
-- conversations that happen to contain the same sentence, so a cache entry
-- written in one chat would be served into another.
--
-- WHY CLIENTS CANNOT WRITE HERE
--
-- There are no INSERT, UPDATE or DELETE policies and no grants. Writes happen
-- only in the translate-message edge function under the service role. If a
-- client could write a row, it could set the stored "translation" of a message
-- to anything it liked and every other reader would then be shown that text as
-- if ONIQ had produced it. Read-only for clients closes that off completely.

-- ---------------------------------------------------------------- table ----

create table if not exists public.message_translations (
  message_id      uuid not null references public.messages (id) on delete cascade,
  target_lang     text not null,
  translated_text text not null,
  -- Which provider produced it, so a bad batch can be found and cleared.
  engine          text not null,
  -- What the model reported the source was. Advisory only; nothing branches
  -- on it, because detection is a guess and a wrong guess must not change
  -- behaviour.
  source_lang     text,
  created_at      timestamptz not null default now(),
  primary key (message_id, target_lang),
  -- Shape only. The real allowlist is SUPPORTED_LANGS in
  -- supabase/functions/_shared/llm.ts, checked in the edge function; this
  -- just stops junk and unbounded values reaching the table. Loose enough for
  -- the three-letter codes (brx, kok, sat) and for zh-TW.
  constraint message_translation_lang_shape
    check (target_lang ~ '^[A-Za-z]{2,3}(-[A-Za-z]{2,4})?$'),
  constraint message_translation_not_empty
    check (length(translated_text) > 0)
);

comment on table public.message_translations is
  'On-demand translation cache, one row per (message, target language). Client-readable only; all writes go through the translate-message edge function.';

alter table public.message_translations enable row level security;

-- ------------------------------------------------------------- read gate ---

-- Mirrors messages_select EXACTLY, including the soft-delete rule.
--
-- That last part matters: if this only checked conversation membership, a
-- cached translation would outlive a deleted message and become a way to read
-- what someone deleted. The translation is visible on precisely the same terms
-- as the message it belongs to, and no other terms.
create or replace function public.can_read_message(_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from messages m
    where m.id = _message_id
      and is_conversation_member(m.conversation_id, auth.uid())
      and (coalesce(m.is_deleted, false) = false or m.sender_id = auth.uid())
  );
$$;

revoke all on function public.can_read_message(uuid) from public, anon;
grant execute on function public.can_read_message(uuid) to authenticated;

-- SELECT only. No INSERT/UPDATE/DELETE policy exists, so those are denied for
-- every client role no matter what grants drift in later.
create policy message_translations_select
  on public.message_translations
  for select
  to authenticated
  using (public.can_read_message(message_id));

-- REVOKE FIRST, THEN GRANT EXACTLY WHAT IS WANTED.
--
-- Supabase ships `alter default privileges in schema public grant all on
-- tables to authenticated`, so a brand-new table arrives with INSERT, UPDATE
-- and DELETE already granted. A bare `grant select` is additive and leaves all
-- three in place — which is what happened on the first run of this migration.
--
-- RLS still denied those writes, because no write policy exists. But a grant
-- nobody intended is a trap set for the next person who adds a permissive
-- policy, and the file would have been describing a state the database was
-- not in. Same lesson as the PUBLIC function grants in 20260807000000.
revoke all on table public.message_translations from anon, authenticated, public;
grant select on table public.message_translations to authenticated;

-- ------------------------------------------------------ edit invalidation --

-- An edited message whose translation is not cleared shows the OLD text
-- translated, which is worse than showing nothing: it looks authoritative and
-- it is wrong. Clearing on edit means the next reader pays for one retranslate
-- and sees the truth.
--
-- Also fires on soft delete, so the cached text goes away with the message
-- rather than lingering as a row nobody can read but everybody still stores.
create or replace function public.clear_message_translations()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  delete from message_translations where message_id = new.id;
  return new;
end;
$$;

revoke all on function public.clear_message_translations() from public, anon, authenticated;

drop trigger if exists messages_clear_translations on public.messages;
create trigger messages_clear_translations
  after update of content, is_deleted on public.messages
  for each row
  when (
    new.content is distinct from old.content
    or new.is_deleted is distinct from old.is_deleted
  )
  execute function public.clear_message_translations();

-- ---------------------------------------------------------------- down ----
--
-- drop trigger if exists messages_clear_translations on public.messages;
-- drop function if exists public.clear_message_translations();
-- drop function if exists public.can_read_message(uuid);
-- drop table if exists public.message_translations;
