-- ============================================================================
-- CHANNEL CREATION FIX — the type CHECK never learned the word 'channel'.
--
-- Production diagnosis (2026-08-12, raw): conversations_type_check allows
-- only ('direct','group'), while create_channel inserts type='channel' —
-- so EVERY channel creation has failed on the constraint since the feature
-- shipped, and conversations_public_channels_select has been selecting from
-- a set that could never have a row. RLS was never the blocker; the
-- SECURITY DEFINER function sails past policies and dies on the CHECK.
-- ============================================================================
alter table public.conversations drop constraint if exists conversations_type_check;
alter table public.conversations add constraint conversations_type_check
  check (type in ('direct', 'group', 'channel'));
