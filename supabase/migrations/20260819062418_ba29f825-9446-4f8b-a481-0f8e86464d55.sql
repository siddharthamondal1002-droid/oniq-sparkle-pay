-- Track A2 — per-conversation translation preference.
--
-- MESSAGE STORAGE IS SERVER-READABLE BY DESIGN. Recorded decision, not an
-- oversight: server-side translation of another person's words requires the
-- server to read them. E2EE and server-side translation are mutually
-- exclusive. The path to both is on-device translation; when E2EE is built it
-- uses libsignal or MLS (RFC 9420), never a custom protocol. No part of ONIQ
-- claims end-to-end encryption.
create table if not exists public.conversation_translation_prefs (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, conversation_id)
);

revoke all on table public.conversation_translation_prefs from anon, authenticated, public;
grant select, insert, update, delete on table public.conversation_translation_prefs to authenticated;
grant all on table public.conversation_translation_prefs to service_role;

alter table public.conversation_translation_prefs enable row level security;

create policy conv_translation_prefs_own on public.conversation_translation_prefs
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_conversation_member(conversation_id, auth.uid()));

-- Down migration (kept as comments, additive-reversible):
-- drop policy if exists conv_translation_prefs_own on public.conversation_translation_prefs;
-- drop table if exists public.conversation_translation_prefs;